/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RealtimeService } from 'src/realtime/realtime.service';
import { SupportAuthor, TicketStatus } from './../../generated/prisma/enums';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { PostReplyDto } from './dto/post-reply.dto';

@Injectable()
export class CustomerSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}
  private readonly logger = new Logger(CustomerSupportService.name);

  async createTicket(userId: string, dto: CreateTicketDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        status: TicketStatus.NEW,
        priority: dto.priority ?? 'NORMAL',
        escalationReason: dto.escalationReason ?? null,
        messages: {
          create: {
            authorType: SupportAuthor.USER,
            authorName: user.fullName,
            authorId: userId,
            content: dto.initialMessage,
          },
        },
      },
      include: {
        user: { select: { fullName: true } },
        messages: true,
      },
    });
    this.logger.log(`Created SupportTicket: id=${ticket.id} userId=${userId}`);
    // Real-time broadcast to connected admins
    this.realtime.supportTicketCreated({
      ticketId: ticket.id,
      subject: dto.subject,
      userName: user.fullName,
      priority: ticket.priority,
      createdAt: ticket.createdAt.toISOString(),
    });
    return this.mapToTicketDetail(ticket);
  }
  async getAdminTickets() {
    const tickets = await this.prisma.supportTicket.findMany({
      orderBy: { lastMessageAt: 'desc' },
      include: {
        user: { select: { fullName: true } },
        assignedAdmin: { select: { fullName: true } },
        messages: { orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });
    return {
      items: tickets.map((t) => ({
        id: t.id,
        subject:
          t.escalationReason ??
          t.messages[0]?.content.slice(0, 50) ??
          'تذكرة دعم فني',
        userName: t.user.fullName,
        status: t.status,
        priority: t.priority,
        assignedAdminName: t.assignedAdmin?.fullName ?? null,
        lastMessageAt: t.lastMessageAt.toISOString(),
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }
  async getUserTickets(userId: string) {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        user: { select: { fullName: true } },
        assignedAdmin: { select: { fullName: true } },
        messages: { orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });
    return {
      items: tickets.map((t) => ({
        id: t.id,
        subject:
          t.escalationReason ??
          t.messages[0]?.content.slice(0, 50) ??
          'تذكرة دعم فني',
        userName: t.user.fullName,
        status: t.status,
        priority: t.priority,
        assignedAdminName: t.assignedAdmin?.fullName ?? null,
        lastMessageAt: t.lastMessageAt.toISOString(),
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }
  async addAdminReply(ticketId: string, adminId: string, dto: PostReplyDto) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { id: true, fullName: true },
    });
    if (!admin) throw new NotFoundException('Admin not found');
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });

    const message = await this.prisma.supportMessage.create({
      data: {
        ticketId,
        authorType: SupportAuthor.ADMIN,
        authorName: admin?.fullName ?? 'الدعم الفني',
        authorId: adminId,
        content: dto.content,
        internal: dto.internal ?? false,
      },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: dto.internal ? ticket.status : TicketStatus.WAITING,
        lastMessageAt: new Date(),
      },
    });
    this.realtime.supportMessageRecieved(ticket.userId, {
      ticketId,
      authorName: message.authorName,
      content: message.content,
      internal: message.internal,
      at: message.createdAt.toISOString(),
    });
    return this.getTicketDetail(ticketId);
  }
  async addUserReply(ticketId: string, userId: string, content: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.userId !== userId) throw new ForbiddenException('Access denied');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    await this.prisma.supportMessage.create({
      data: {
        ticketId,
        authorType: SupportAuthor.USER,
        authorName: user?.fullName ?? 'المستخدم',
        authorId: userId,
        content,
      },
    });
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        lastMessageAt: new Date(),
        status: TicketStatus.IN_PROGRESS,
      },
    });
    return this.getTicketDetail(ticketId, userId);
  }
  async getTicketDetail(ticketId: string, userId?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { fullName: true } },
        assignedAdmin: { select: { fullName: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return this.mapToTicketDetail(ticket, userId);
  }
  async assignToAdmin(ticketId: string, userId: string) {
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        assignedAdminId: userId,
        status: TicketStatus.IN_PROGRESS,
      },
    });
    return this.getTicketDetail(ticketId);
  }
  async updateStatus(ticketId: string, status: TicketStatus) {
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status },
    });
    return this.getTicketDetail(ticketId);
  }
  private mapToTicketDetail(ticket: any, requestingUserId?: string) {
    const filteredMessages = ticket.messages
      .filter((m: any) => !m.internal || requestingUserId !== ticket.userId)
      .map((m: any) => ({
        id: m.id,
        authorType: m.authorType,
        author: m.authorType,
        authorName: m.authorName,
        content: m.content,
        internal: m.internal,
        createdAt: m.createdAt.toISOString(),
        at: m.createdAt.toISOString(),
      }));
    return {
      id: ticket.id,
      userId: ticket.userId,
      subject:
        ticket.escalationReason ??
        ticket.messages[0]?.content.slice(0, 50) ??
        'تذكرة دعم فني',
      userName: ticket.user.fullName,
      status: ticket.status,
      priority: ticket.priority,
      escalationReason: ticket.escalationReason,
      aiSummary: ticket.aiSummary,
      assignedAdminId: ticket.assignedAdminId,
      assignedAdminName: ticket.assignedAdmin?.fullName ?? null,
      lastMessageAt: ticket.lastMessageAt.toISOString(),
      createdAt: ticket.createdAt.toISOString(),
      messages: filteredMessages,
    };
  }
}
