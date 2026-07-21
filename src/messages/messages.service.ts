import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  private async connectionFor(userId: string, id: string) {
    const connection = await this.prisma.matchConnection.findFirst({
      where: { id, status: 'CONNECTED', OR: [{ tenantId: userId }, { ownerId: userId }] },
      select: { id: true, tenantId: true, ownerId: true },
    });
    if (!connection) throw new NotFoundException('Conversation not found.');
    return connection;
  }

  async list(userId: string) {
    const matches = await this.prisma.matchConnection.findMany({
      where: { status: 'CONNECTED', OR: [{ tenantId: userId }, { ownerId: userId }] },
      select: { id: true, tenantId: true, ownerId: true, propertyId: true, createdAt: true, tenant: { select: { fullName: true } }, owner: { select: { fullName: true } }, property: { select: { title: true, propertyImages: { where: { isCover: true }, orderBy: { displayOrder: 'asc' }, take: 1, select: { imageUrl: true } } }, }, messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, createdAt: true } } },
    });
    return matches.map((m) => ({ matchConnectionId: m.id, propertyId: m.propertyId, propertyTitle: m.property.title, propertyCoverImage: m.property.propertyImages[0]?.imageUrl ?? null, otherParticipantName: m.tenantId === userId ? m.owner.fullName : m.tenant.fullName, connectionStatus: 'CONNECTED', lastMessagePreview: m.messages[0] ? m.messages[0].body.slice(0, 100) : null, lastMessageAt: m.messages[0]?.createdAt.toISOString() ?? null })).sort((a,b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
  }

  async messages(userId: string, id: string) {
    await this.connectionFor(userId, id);
    const rows = await this.prisma.message.findMany({ where: { matchConnectionId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, senderId: true, body: true, createdAt: true } });
    return rows.map((m) => ({ ...m, createdAt: m.createdAt.toISOString(), isMine: m.senderId === userId }));
  }

  async send(userId: string, id: string, input: { body: string }) {
    await this.connectionFor(userId, id);
    const body = input.body.trim();
    if (!body || body.length > 1000) throw new BadRequestException('Invalid message body.');
    const message = await this.prisma.message.create({ data: { matchConnectionId: id, senderId: userId, body }, select: { id: true, senderId: true, body: true, createdAt: true } });
    return { ...message, createdAt: message.createdAt.toISOString(), isMine: true };
  }
}
