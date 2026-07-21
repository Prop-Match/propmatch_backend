import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';
import {
  SOCKET_EVENTS,
  type MessagePayload,
  type NotificationPayload,
  type NotificationType,
  type QueueItem,
} from './realtime.contract';

/**
 * The realtime API the rest of the team calls
 *
 * Teammates inject THIS, never the gateway — they call one typed method and
 * stay ignorant of rooms, event names, and socket internals:
 *
 *   // After creating a PENDING property:
 *   this.realtime.propertySubmitted(property);
 *
 *   // After approving it (Week 2):
 *   await this.realtime.notifyUser(ownerId, {
 *     type: 'PROPERTY_APPROVED', title: '...', message: '...', link: '...',
 *   });
 *
 * ## Two kinds of realtime, on purpose
 * - **Admin queue items** (`*Submitted`) are *ephemeral*. They mirror the
 *   frontend's `GET /api/admin/queues`, which is reconstructable from the
 *   PENDING rows — so a reconnecting admin catches up on fetch. Not persisted.
 * - **User notifications** (`notifyUser`) ARE persisted to the `notification`
 *   table first, then pushed. The socket is delivery; the row is truth, so a
 *   user who was offline sees it on their next `GET /api/notifications`.
 */
@Injectable()
export class RealtimeService {
  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly prisma: PrismaService,
  ) {}

  /* Each mirrors a frontend queue-item builder (src/mocks/router.ts). The
   * `q_` id prefix and the subtitle wording must match, or the pushed item
   * and the fetched one render differently for the same thing. */

  /** A new eKYC submission needs review. (Sprint: "a new user registers".) */
  kycSubmitted(input: { userId: string; userName: string; submittedAt?: Date }): void {
    this.announce({
      id: `q_${input.userId}`,
      type: 'kyc',
      subjectId: input.userId,
      title: input.userName,
      subtitle: 'مستخدم جديد بحاجة لمراجعة',
      submittedAt: iso(input.submittedAt),
    });
  }

  /** A new property was submitted (PENDING). */
  propertySubmitted(input: {
    id: string;
    title: string;
    district: string;
    rentAmount: number;
    createdAt?: Date;
  }): void {
    this.announce({
      id: `q_${input.id}`,
      type: 'property',
      subjectId: input.id,
      title: input.title,
      subtitle: `${input.district} · ${input.rentAmount} ج.م/شهريًا`,
      submittedAt: iso(input.createdAt),
    });
  }

  /** A new tenant request was submitted (PENDING). */
  tenantRequestSubmitted(input: {
    id: string;
    preferredLocations: string;
    minBudget: number;
    maxBudget: number;
    createdAt?: Date;
  }): void {
    this.announce({
      id: `q_${input.id}`,
      type: 'request',
      subjectId: input.id,
      title: `طلب سكن في ${input.preferredLocations}`,
      subtitle: `${input.minBudget}–${input.maxBudget} ج.م`,
      submittedAt: iso(input.createdAt),
    });
  }

  /** A new property review was submitted (PENDING). */
  reviewSubmitted(input: {
    id: string;
    rating: number;
    comment?: string | null;
    createdAt?: Date;
  }): void {
    this.announce({
      id: `q_${input.id}`,
      type: 'review',
      subjectId: input.id,
      title: `تقييم ${input.rating}★`,
      subtitle: (input.comment ?? '').slice(0, 60),
      submittedAt: iso(input.createdAt),
    });
  }

  /** Escape hatch for any queue arrival not covered above. */
  announce(item: QueueItem): void {
    this.gateway.emitToAdmins(SOCKET_EVENTS.adminQueueItem, item);
  }


  /**
   * Persist a NOTIFICATION and push it to the user live. Returns the row.
   * Persist-then-emit, never the reverse: if the emit fails the row still
   * exists and the user gets it on next fetch; the socket must never be the
   * only copy.
   */
  async notifyUser(
    userId: string,
    input: {
      type: NotificationType;
      title: string;
      message: string;
      link?: string | null;
    },
  ): Promise<NotificationPayload> {
    const row = await this.prisma.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link ?? null,
      },
    });

    const payload: NotificationPayload = {
      id: row.id,
      type: row.type as NotificationType,
      title: row.title,
      message: row.message,
      link: row.link,
      isRead: row.isRead,
      createdAt: row.createdAt.toISOString(),
    };
    // userId routes the event; it is not part of the client payload.
    this.gateway.emitToUser(userId, SOCKET_EVENTS.notification, payload);
    return payload;
  }

  emitMessage(userId: string, payload: MessagePayload): void {
    this.gateway.emitToUser(userId, SOCKET_EVENTS.message, payload);
  }
}

const iso = (d?: Date): string => (d ?? new Date()).toISOString();
