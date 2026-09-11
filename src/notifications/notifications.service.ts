import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PushNotificationService } from './services/push-notification.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushNotificationService,
  ) {}

  async list(userId: string) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const items = rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      link: n.link,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    }));

    return { items, unread: items.filter((n) => !n.isRead).length };
  }

  /** Mark one notification read. Scoped to the owner so users can't touch others'. */
  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
    return { ok: true };
  }

  /** Mark all of the user's unread notifications read. */
  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { ok: true };
  }

  async registerDeviceToken(userId: string, token: string, platform?: string) {
    await this.pushService.saveDeviceToken(userId, token, platform);
    return { ok: true };
  }

  async removeDeviceToken(token: string) {
    await this.pushService.removeDeviceToken(token);
    return { ok: true };
  }
}
