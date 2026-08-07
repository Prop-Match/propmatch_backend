/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'prisma/prisma.service';
import { RealtimeService } from 'src/realtime/realtime.service';
import {
  NotificationType,
  SupportAuthor,
  TicketStatus,
} from './../../generated/prisma/enums';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { PostReplyDto } from './dto/post-reply.dto';
import type { WireTicketStatus } from './ticket-status.mapper';
import { ticketStatusToDb, ticketStatusToWire } from './ticket-status.mapper';

/** Normalize the optional attachment fields off a reply DTO (empty ⇒ nulls). */
function attachmentFields(dto: PostReplyDto) {
  const has = Boolean(dto.attachmentUrl && dto.attachmentType);
  return {
    attachmentUrl: has ? dto.attachmentUrl! : null,
    attachmentType: has ? dto.attachmentType! : null,
    attachmentName: has ? (dto.attachmentName ?? null) : null,
    attachmentDurationMs: has ? (dto.attachmentDurationMs ?? null) : null,
  };
}

/** Short notification preview: the text, or an attachment-type label. */
function replyPreview(
  content: string | undefined,
  type: string | null,
): string {
  const text = content?.trim();
  if (text) return `${text.slice(0, 50)}...`;
  if (type === 'IMAGE') return 'صورة مرفقة';
  if (type === 'VIDEO') return 'فيديو مرفق';
  if (type === 'AUDIO') return 'رسالة صوتية';
  return 'مرفق';
}

@Injectable()
export class CustomerSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
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
        status: ticketStatusToWire(t.status),
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
        status: ticketStatusToWire(t.status),
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

    const attachment = attachmentFields(dto);
    if (!dto.content?.trim() && !attachment.attachmentUrl) {
      throw new BadRequestException('اكتب رداً أو أرفق ملفاً');
    }
    const message = await this.prisma.supportMessage.create({
      data: {
        ticketId,
        authorType: SupportAuthor.ADMIN,
        authorName: 'الدعم الفني',
        authorId: adminId,
        content: dto.content?.trim() ?? '',
        internal: dto.internal ?? false,
        ...attachment,
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
      ...attachment,
    });

    if (!dto.internal) {
      await this.realtime.notifyUser(ticket.userId, {
        type: NotificationType.NEW_MESSAGE,
        title: 'رد جديد من الدعم الفني',
        message: `أضاف فريق الدعم الفني رداً جديداً على تذكرتك: "${replyPreview(dto.content, attachment.attachmentType)}"`,
        link: `/support/tickets/${ticketId}`,
      });
    }

    return this.getTicketDetail(ticketId);
  }

  async addUserReply(ticketId: string, userId: string, dto: PostReplyDto) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { user: { select: { fullName: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.userId !== userId) throw new ForbiddenException('Access denied');

    const attachment = attachmentFields(dto);
    if (!dto.content?.trim() && !attachment.attachmentUrl) {
      throw new BadRequestException('اكتب رداً أو أرفق ملفاً');
    }
    const content = dto.content?.trim() ?? '';
    const message = await this.prisma.supportMessage.create({
      data: {
        ticketId,
        authorType: SupportAuthor.USER,
        authorName: ticket.user?.fullName ?? 'المستخدم',
        authorId: userId,
        content,
        ...attachment,
      },
    });

    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        lastMessageAt: new Date(),
        status: TicketStatus.IN_PROGRESS,
      },
    });

    const payload = {
      ticketId,
      authorName: message.authorName,
      content: message.content,
      internal: false,
      at: message.createdAt.toISOString(),
      ...attachment,
    };

    // Realtime to every admin (assignee or not) so an open ticket updates live.
    this.realtime.supportMessageToAdmins(payload);

    if (ticket.assignedAdminId) {
      await this.realtime.notifyUser(ticket.assignedAdminId, {
        type: NotificationType.NEW_MESSAGE,
        title: 'رد جديد من المستخدم',
        message: `أضاف ${ticket.user?.fullName ?? 'المستخدم'} رداً جديداً: "${replyPreview(content, attachment.attachmentType)}"`,
        link: `/admin/tickets/${ticketId}`,
      });
    }

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
  async updateStatus(ticketId: string, status: WireTicketStatus) {
    const normalized = String(status || '').toLowerCase() as WireTicketStatus;
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: ticketStatusToDb(normalized) },
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
        authorName:
          m.authorType === SupportAuthor.ADMIN ||
          String(m.authorType).toUpperCase() === 'ADMIN'
            ? 'الدعم الفني'
            : m.authorName,
        content: m.content,
        internal: m.internal,
        attachmentUrl: m.attachmentUrl ?? null,
        attachmentType: m.attachmentType ?? null,
        attachmentName: m.attachmentName ?? null,
        attachmentDurationMs: m.attachmentDurationMs ?? null,
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
      status: ticketStatusToWire(ticket.status),
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

  async openAiStream(
    message: string,
    history: any[] | undefined,
    user: { userId: string; role?: string },
    clientSignal?: AbortSignal,
  ) {
    const baseUrl =
      this.config.get<string>('LEGAL_SUPPORT_API_URL') ||
      'http://localhost:8001';
    const serviceKey = this.config.get<string>(
      'LEGAL_SUPPORT_INTERNAL_API_KEY',
    );
    if (!baseUrl || !serviceKey) {
      throw new ServiceUnavailableException(
        'AI Customer Support service is not configured.',
      );
    }
    const timeoutSignal = AbortSignal.timeout(120000);
    const signal = clientSignal
      ? AbortSignal.any([clientSignal, timeoutSignal])
      : timeoutSignal;
    const userDetails = await this.prisma.user.findUnique({
      where: { id: user.userId },
      include: { identityVerification: true },
    });
    // Minimize what crosses the trust boundary to the external LLM: the
    // assistant only needs the account role and whether KYC is verified to
    // tailor guidance. The user's real name and free-text KYC rejection reason
    // are PII with no bearing on a how-to answer, so they are NOT sent.
    const body = {
      message,
      history,
      userContext: {
        role: user.role,
        kycStatus: userDetails?.identityVerification?.status || 'NOT_SUBMITTED',
      },
    };
    let response: Response;
    try {
      response = await fetch(
        `${baseUrl.replace(/\/$/, '')}/support/ai-chat/stream`,
        {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
            'X-Internal-Service-Key': serviceKey,
            'X-PropMatch-User-Id': user.userId,
            'X-PropMatch-User-Role': user.role || 'TENANT',
          },
          body: JSON.stringify(body),
          signal,
        },
      );
    } catch (error) {
      if (timeoutSignal.aborted && !clientSignal?.aborted) {
        throw new GatewayTimeoutException('Support AI service timed out.');
      }
      throw new ServiceUnavailableException(
        'Support AI service is unavailable.',
        {
          cause: error,
        },
      );
    }

    if (!response.ok) {
      throw new BadGatewayException('Support AI service rejected the request.');
    }
    if (!response.body) {
      throw new BadGatewayException(
        'Support AI service returned an empty stream.',
      );
    }
    return response;
  }
}
