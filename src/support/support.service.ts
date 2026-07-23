import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateHandoffDto } from './dto/create-handoff.dto';
import { ReplyTicketDto } from './dto/reply-ticket.dto';
import {
  ticketStatusToDb,
  ticketStatusToWire,
  WireTicketStatus,
} from './ticket-status.mapper';

const AI_AUTHOR_NAME = 'المساعد الذكي';

const TICKET_WITH_RELATIONS = {
  user: { select: { fullName: true } },
  assignedAdmin: { select: { fullName: true } },
  messages: {
    orderBy: { createdAt: 'asc' as const },
    include: { authorUser: { select: { fullName: true } } },
  },
};

type TicketWithRelations = Awaited<
  ReturnType<SupportService['findTicketOrThrow']>
>;

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Called by the external legal-support AI service's transfer_to_human_support tool. */
  async createFromHandoff(dto: CreateHandoffDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.user_id },
    });
    if (!user) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    const subject = (dto.subject ?? dto.chat_summary).slice(0, 200);
    const now = new Date();

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId: user.id,
        subject,
        status: 'NEW',
        lastMessageAt: now,
        messages: {
          create: {
            author: 'AI',
            content: dto.chat_summary,
            internal: false,
            createdAt: now,
          },
        },
      },
      include: TICKET_WITH_RELATIONS,
    });

    return this.toTicketDetail(ticket);
  }

  async listTickets() {
    const tickets = await this.prisma.supportTicket.findMany({
      orderBy: { lastMessageAt: 'desc' },
      include: TICKET_WITH_RELATIONS,
    });
    return { items: tickets.map((t) => this.toTicketSummary(t)) };
  }

  async getTicket(id: string) {
    const ticket = await this.findTicketOrThrow(id);
    return this.toTicketDetail(ticket);
  }

  async reply(adminId: string, ticketId: string, dto: ReplyTicketDto) {
    const ticket = await this.findTicketOrThrow(ticketId);
    const now = new Date();
    const internal = dto.internal ?? false;
    // An internal note is not a customer reply — it must not move the
    // ticket forward (mocks/router.ts parity).
    const shouldAdvanceStatus =
      !internal && (ticket.status === 'NEW' || ticket.status === 'ASSIGNED');

    await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: {
          ticketId,
          author: 'ADMIN',
          authorId: adminId,
          content: dto.content.trim(),
          internal,
          createdAt: now,
        },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          lastMessageAt: now,
          ...(shouldAdvanceStatus ? { status: 'IN_PROGRESS' } : {}),
        },
      }),
    ]);

    const updated = await this.findTicketOrThrow(ticketId);
    return this.toTicketDetail(updated);
  }

  async assign(adminId: string, ticketId: string) {
    const ticket = await this.findTicketOrThrow(ticketId);
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        assignedAdminId: adminId,
        status: ticket.status === 'NEW' ? 'ASSIGNED' : undefined,
      },
    });
    const updated = await this.findTicketOrThrow(ticketId);
    return this.toTicketDetail(updated);
  }

  async setStatus(ticketId: string, status: WireTicketStatus) {
    await this.findTicketOrThrow(ticketId);
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: ticketStatusToDb(status) },
    });
    const updated = await this.findTicketOrThrow(ticketId);
    return this.toTicketDetail(updated);
  }

  private async findTicketOrThrow(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: TICKET_WITH_RELATIONS,
    });
    if (!ticket) {
      throw new NotFoundException('TICKET_NOT_FOUND');
    }
    return ticket;
  }

  private toTicketSummary(ticket: TicketWithRelations) {
    return {
      id: ticket.id,
      subject: ticket.subject,
      userName: ticket.user.fullName,
      status: ticketStatusToWire(ticket.status),
      assignedAdminName: ticket.assignedAdmin?.fullName ?? null,
      lastMessageAt: ticket.lastMessageAt.toISOString(),
      createdAt: ticket.createdAt.toISOString(),
    };
  }

  private toTicketDetail(ticket: TicketWithRelations) {
    return {
      ...this.toTicketSummary(ticket),
      userId: ticket.userId,
      assignedAdminId: ticket.assignedAdminId,
      messages: ticket.messages.map((m) => ({
        id: m.id,
        author: m.author.toLowerCase() as 'ai' | 'user' | 'admin',
        authorName:
          m.author === 'AI'
            ? AI_AUTHOR_NAME
            : m.author === 'USER'
              ? ticket.user.fullName
              : (m.authorUser?.fullName ?? ''),
        content: m.content,
        internal: m.internal,
        at: m.createdAt.toISOString(),
      })),
    };
  }
}
