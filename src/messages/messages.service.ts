import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { decryptText, encryptText } from './crypto.util';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  private async connectionFor(userId: string, id: string) {
    const connection = await this.prisma.matchConnection.findFirst({
      where: {
        id,
        status: 'CONNECTED',
        OR: [{ tenantId: userId }, { ownerId: userId }],
      },
      select: { id: true, tenantId: true, ownerId: true },
    });
    if (!connection) throw new NotFoundException('Conversation not found.');
    return connection;
  }

  async list(userId: string) {
    const matches = await this.prisma.matchConnection.findMany({
      where: {
        status: 'CONNECTED',
        OR: [{ tenantId: userId }, { ownerId: userId }],
      },
      select: {
        id: true,
        tenantId: true,
        ownerId: true,
        propertyId: true,
        createdAt: true,
        tenant: { select: { fullName: true } },
        owner: { select: { fullName: true } },
        property: {
          select: {
            title: true,
            propertyImages: {
              where: { isCover: true },
              orderBy: { displayOrder: 'asc' },
              take: 1,
              select: { imageUrl: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, createdAt: true },
        },
      },
    });
    return matches
      .map((m) => ({
        matchConnectionId: m.id,
        propertyId: m.propertyId,
        propertyTitle: m.property.title,
        propertyCoverImage: m.property.propertyImages[0]?.imageUrl ?? null,
        otherParticipantName:
          m.tenantId === userId ? m.owner.fullName : m.tenant.fullName,
        connectionStatus: 'CONNECTED',
        lastMessagePreview: m.messages[0]
          ? decryptText(m.messages[0].body).slice(0, 100)
          : null,
        lastMessageAt: m.messages[0]?.createdAt.toISOString() ?? null,
      }))
      .sort((a, b) =>
        (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''),
      );
  }

  async messages(userId: string, id: string) {
    await this.connectionFor(userId, id);
    const rows = await this.prisma.message.findMany({
      where: { matchConnectionId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        senderId: true,
        body: true,
        createdAt: true,
        attachmentUrl: true,
        attachmentType: true,
        attachmentName: true,
        attachmentDurationMs: true,
      },
    });
    return rows.map((m) => ({
      ...m,
      body: decryptText(m.body),
      createdAt: m.createdAt.toISOString(),
      isMine: m.senderId === userId,
    }));
  }

  async send(
    userId: string,
    id: string,
    input: {
      body?: string;
      attachmentUrl?: string;
      attachmentType?: 'IMAGE' | 'VIDEO' | 'AUDIO';
      attachmentName?: string;
      attachmentDurationMs?: number;
    },
  ) {
    const connection = await this.connectionFor(userId, id);
    const body = (input.body ?? '').trim();
    const hasAttachment = Boolean(input.attachmentUrl && input.attachmentType);
    if (!body && !hasAttachment)
      throw new BadRequestException('Empty message.');
    if (body.length > 1000)
      throw new BadRequestException('Invalid message body.');

    const encryptedBody = encryptText(body);

    const message = await this.prisma.message.create({
      data: {
        matchConnectionId: id,
        senderId: userId,
        body: encryptedBody,
        attachmentUrl: hasAttachment ? input.attachmentUrl : null,
        attachmentType: hasAttachment ? input.attachmentType : null,
        attachmentName: hasAttachment ? (input.attachmentName ?? null) : null,
        attachmentDurationMs: hasAttachment
          ? (input.attachmentDurationMs ?? null)
          : null,
      },
      select: {
        id: true,
        senderId: true,
        body: true,
        createdAt: true,
        attachmentUrl: true,
        attachmentType: true,
        attachmentName: true,
        attachmentDurationMs: true,
      },
    });
    const payload = {
      ...message,
      body,
      createdAt: message.createdAt.toISOString(),
    };
    const recipientId =
      connection.tenantId === userId ? connection.ownerId : connection.tenantId;
    this.realtime.emitMessage(recipientId, {
      ...payload,
      matchConnectionId: id,
    });
    await this.realtime.notifyUser(recipientId, {
      type: 'NEW_MESSAGE',
      title: 'رسالة جديدة',
      message: 'لديك رسالة جديدة بشأن أحد عروضك المقبولة.',
      link:
        connection.tenantId === recipientId
          ? `/tenant/messages/${id}`
          : `/landlord/messages/${id}`,
    });

    return { ...payload, isMine: true };
  }

  async updateMessage(userId: string, messageId: string, body: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('الرسالة غير موجودة');
    if (message.senderId !== userId) throw new BadRequestException('لا يمكنك تعديل رسالة شخص آخر');

    const diffMinutes = (Date.now() - message.createdAt.getTime()) / (1000 * 60);
    if (diffMinutes > 15) {
      throw new BadRequestException('لا يمكنك تعديل الرسالة بعد مرور 15 دقيقة من إرسالها');
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { body: encryptText(body.trim()) },
    });

    return {
      ...updated,
      body: body.trim(),
      createdAt: updated.createdAt.toISOString(),
      isMine: true,
    };
  }

  async deleteMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('الرسالة غير موجودة');
    if (message.senderId !== userId) throw new BadRequestException('لا يمكنك حذف رسالة شخص آخر');

    const diffMinutes = (Date.now() - message.createdAt.getTime()) / (1000 * 60);
    if (diffMinutes > 15) {
      throw new BadRequestException('لا يمكنك حذف الرسالة بعد مرور 15 دقيقة من إرسالها');
    }

    await this.prisma.message.delete({ where: { id: messageId } });
    return { success: true, id: messageId };
  }
}
