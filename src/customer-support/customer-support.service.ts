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
import { MailService } from 'src/mail/mail.service';
import {
  NotificationType,
  SupportAuthor,
  SupportPriority,
  TicketStatus,
} from './../../generated/prisma/enums';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { PostReplyDto } from './dto/post-reply.dto';
import type { WireTicketStatus } from './ticket-status.mapper';
import {
  ticketStatusToDb,
  ticketStatusToWire,
  WIRE_TICKET_STATUSES,
} from './ticket-status.mapper';

const COMMERCIAL_PRIORITIES = ['FREEMIUM', 'OWNER_PLUS', 'PREMIUM'] as const;
type CommercialPriority = (typeof COMMERCIAL_PRIORITIES)[number];

interface AdminTicketQuery {
  status?: string;
  commercialPriority?: string;
  page?: number;
  pageSize?: number;
}

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
    private readonly mail: MailService,
  ) {}
  private readonly logger = new Logger(CustomerSupportService.name);

  static readonly SUSPENSION_APPEAL_REASON = 'طلب مراجعة إيقاف الحساب';

  private readonly ticketDetailInclude = {
    user: { select: { fullName: true } },
    assignedAdmin: { select: { fullName: true } },
    messages: { orderBy: { createdAt: 'asc' as const } },
  };

  /**
   * Create the support ticket used by a suspended account to appeal the
   * suspension. Authentication happens in AuthService because suspended JWTs
   * are deliberately rejected; this method only owns ticket persistence and
   * admin notification. Reuse an open appeal so repeated login attempts cannot
   * flood the support queue.
   */
  async createSuspensionAppeal(
    user: { id: string; fullName: string },
    message?: string,
  ) {
    const existing = await this.prisma.supportTicket.findFirst({
      where: {
        userId: user.id,
        escalationReason: CustomerSupportService.SUSPENSION_APPEAL_REASON,
        status: { not: TicketStatus.CLOSED },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    if (existing) {
      return {
        id: existing.id,
        kind: 'SUSPENSION_APPEAL' as const,
        status: ticketStatusToWire(existing.status),
      };
    }

    const content =
      message?.trim() || 'أطلب مراجعة قرار إيقاف حسابي وإعادة تفعيله إذا أمكن.';
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId: user.id,
        status: TicketStatus.NEW,
        priority: SupportPriority.HIGH,
        escalationReason: CustomerSupportService.SUSPENSION_APPEAL_REASON,
        messages: {
          create: {
            authorType: SupportAuthor.USER,
            authorName: user.fullName,
            authorId: user.id,
            content,
          },
        },
      },
      select: {
        id: true,
        status: true,
        priority: true,
        createdAt: true,
      },
    });

    this.realtime.supportTicketCreated({
      ticketId: ticket.id,
      subject: CustomerSupportService.SUSPENSION_APPEAL_REASON,
      userName: user.fullName,
      priority: ticket.priority,
      createdAt: ticket.createdAt.toISOString(),
    });
    return {
      id: ticket.id,
      kind: 'SUSPENSION_APPEAL' as const,
      status: ticketStatusToWire(ticket.status),
    };
  }

  /**
   * Persist an AI-requested handoff using the authenticated gateway user.
   * The request UUID makes retries idempotent, while reusing another open
   * ticket prevents the assistant from flooding the support queue.
   */
  async createAgentEscalation(
    userId: string,
    input: {
      agentRunId: string;
      message: string;
      reason: string;
      priority: SupportPriority;
    },
  ): Promise<{ id: string }> {
    const duplicate = await this.prisma.supportTicket.findUnique({
      where: { agentEscalationKey: input.agentRunId },
      include: this.ticketDetailInclude,
    });
    if (duplicate) return this.mapToTicketDetail(duplicate, userId);

    const openTicket = await this.prisma.supportTicket.findFirst({
      where: { userId, status: { not: TicketStatus.CLOSED } },
      orderBy: { updatedAt: 'desc' },
      include: this.ticketDetailInclude,
    });
    if (openTicket) {
      // A different agent run must not create a duplicate ticket, but its
      // customer message is still new information for the assigned support
      // team. Append it to the open ticket and notify admins in real time.
      const message = await this.prisma.supportMessage.create({
        data: {
          ticketId: openTicket.id,
          authorType: SupportAuthor.USER,
          authorName: openTicket.user.fullName,
          authorId: userId,
          content: input.message.trim(),
        },
      });
      await this.prisma.supportTicket.update({
        where: { id: openTicket.id },
        data: { lastMessageAt: new Date(), status: TicketStatus.IN_PROGRESS },
      });
      this.realtime.supportMessageToAdmins({
        ticketId: openTicket.id,
        authorName: message.authorName,
        content: message.content,
        internal: false,
        at: message.createdAt.toISOString(),
      });
      return this.mapToTicketDetail(openTicket, userId);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true },
    });
    if (!user) throw new NotFoundException('User not found');

    let ticket;
    try {
      ticket = await this.prisma.supportTicket.create({
        data: {
          userId,
          status: TicketStatus.NEW,
          priority: input.priority,
          escalationReason: input.reason,
          aiSummary: input.reason,
          agentEscalationKey: input.agentRunId,
          messages: {
            create: {
              authorType: SupportAuthor.USER,
              authorName: user.fullName,
              authorId: user.id,
              content: input.message.trim(),
            },
          },
        },
        include: this.ticketDetailInclude,
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      ticket = await this.prisma.supportTicket.findUnique({
        where: { agentEscalationKey: input.agentRunId },
        include: this.ticketDetailInclude,
      });
      if (!ticket) throw error;
      return this.mapToTicketDetail(ticket, userId);
    }

    this.logger.log(
      `Created automatic SupportTicket: id=${ticket.id} userId=${userId}`,
    );
    this.realtime.supportTicketCreated({
      ticketId: ticket.id,
      subject: input.reason.slice(0, 200),
      userName: user.fullName,
      priority: ticket.priority,
      createdAt: ticket.createdAt.toISOString(),
    });
    // The ticket record is the queue's source of truth. Persist a separate
    // notification for every active admin too, so an offline admin sees it in
    // the bell on their next visit and a connected admin is notified at once.
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true, deletedAt: null },
        select: { id: true },
      });
      await this.realtime.notifyUsers(
        admins.map((admin) => ({
          userId: admin.id,
          type: NotificationType.SUPPORT_TICKET_ESCALATED,
          title: 'تصعيد جديد لخدمة العملاء',
          message: `${user.fullName}: ${input.reason.slice(0, 160)}`,
          link: `/admin/support/${ticket.id}`,
        })),
      );
    } catch (error) {
      // The ticket has already been safely persisted and announced to the
      // admin queue; a bell-notification failure must not undo the handoff.
      this.logger.error(
        `Could not notify admins about automatic SupportTicket ${ticket.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
    return this.mapToTicketDetail(ticket, userId);
  }

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
  async getAdminTickets(query: AdminTicketQuery = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20));
    const requestedStatus = query.status?.trim().toLowerCase();
    const status =
      requestedStatus && requestedStatus !== 'all'
        ? requestedStatus
        : undefined;
    if (status && !WIRE_TICKET_STATUSES.includes(status as WireTicketStatus)) {
      throw new BadRequestException('Invalid support ticket status');
    }

    const requestedCommercialPriority = query.commercialPriority
      ?.trim()
      .toUpperCase();
    const commercialPriority =
      requestedCommercialPriority && requestedCommercialPriority !== 'ALL'
        ? requestedCommercialPriority
        : undefined;
    if (
      commercialPriority &&
      !COMMERCIAL_PRIORITIES.includes(commercialPriority as CommercialPriority)
    ) {
      throw new BadRequestException('Invalid commercial priority');
    }

    const tickets = await this.prisma.supportTicket.findMany({
      where: status
        ? { status: ticketStatusToDb(status as WireTicketStatus) }
        : undefined,
      include: {
        user: { select: { fullName: true, userQuota: true } },
        assignedAdmin: { select: { fullName: true } },
        messages: { orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });
    const severityWeight = {
      CRITICAL: 5,
      URGENT: 4,
      HIGH: 3,
      NORMAL: 2,
      LOW: 1,
    } as const;
    const commercialTier = (ticket: (typeof tickets)[number]) => {
      const quota = ticket.user.userQuota;
      const active = quota?.planExpiresAt && quota.planExpiresAt > new Date();
      if (active && quota.planType === 'PREMIUM') return 'PREMIUM' as const;
      if (active && quota.planType === 'OWNER_PLUS') {
        return 'OWNER_PLUS' as const;
      }
      return 'FREEMIUM' as const;
    };
    const commercialWeight = { PREMIUM: 200, OWNER_PLUS: 100, FREEMIUM: 0 };
    const filteredTickets = commercialPriority
      ? tickets.filter(
          (ticket) => commercialTier(ticket) === commercialPriority,
        )
      : tickets;
    filteredTickets.sort((a, b) => {
      const severity = severityWeight[b.priority] - severityWeight[a.priority];
      if (severity !== 0) return severity;
      const score = (ticket: (typeof tickets)[number]) =>
        commercialWeight[commercialTier(ticket)] +
        Math.floor((Date.now() - ticket.createdAt.getTime()) / 86_400_000) * 20;
      return (
        score(b) - score(a) || a.createdAt.getTime() - b.createdAt.getTime()
      );
    });
    const total = filteredTickets.length;
    const pagedTickets = filteredTickets.slice(
      (page - 1) * pageSize,
      page * pageSize,
    );
    return {
      items: pagedTickets.map((t) => ({
        id: t.id,
        subject:
          t.escalationReason ??
          t.messages[0]?.content.slice(0, 50) ??
          'تذكرة دعم فني',
        userName: t.user.fullName,
        status: ticketStatusToWire(t.status),
        priority: t.priority,
        commercialPriority: commercialTier(t),
        assignedAdminName: t.assignedAdmin?.fullName ?? null,
        lastMessageAt: t.lastMessageAt.toISOString(),
        createdAt: t.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
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
      include: { user: { select: { email: true, fullName: true } } },
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
      await this.mail.sendSupportReplyEmail({
        to: ticket.user.email,
        name: ticket.user.fullName,
        ticketId,
        preview: replyPreview(dto.content, attachment.attachmentType),
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
        link: `/admin/support/${ticketId}`,
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
    history: Array<{ role: string; content: string }> | undefined,
    user: { userId: string; role?: string },
    clientRequestId: string,
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
      clientRequestId,
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
