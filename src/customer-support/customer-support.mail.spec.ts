import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import type { RealtimeService } from '../realtime/realtime.service';
import { CustomerSupportService } from './customer-support.service';

describe('CustomerSupportService admin-reply email', () => {
  const notifyUser = jest.fn();
  const supportMessageRecieved = jest.fn();
  const sendSupportReplyEmail = jest.fn();
  const messageCreate = jest.fn();
  const ticketUpdate = jest.fn();
  const ticketFindUnique = jest.fn();
  const service = new CustomerSupportService(
    {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-1',
          fullName: 'Support Admin',
        }),
      },
      supportTicket: { findUnique: ticketFindUnique, update: ticketUpdate },
      supportMessage: { create: messageCreate },
    } as unknown as PrismaService,
    { notifyUser, supportMessageRecieved } as unknown as RealtimeService,
    {} as ConfigService,
    { sendSupportReplyEmail } as unknown as MailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    ticketFindUnique.mockResolvedValue({
      id: 'ticket-1',
      userId: 'user-1',
      status: 'IN_PROGRESS',
      user: { email: 'user@example.com', fullName: 'User' },
    });
    messageCreate.mockResolvedValue({
      authorName: 'الدعم الفني',
      content: 'تم حل المشكلة',
      internal: false,
      createdAt: new Date('2026-08-09T12:00:00.000Z'),
    });
    ticketUpdate.mockResolvedValue({});
    notifyUser.mockResolvedValue({});
    jest.spyOn(service, 'getTicketDetail').mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  it('preserves realtime delivery and emails the user for a public reply', async () => {
    await service.addAdminReply('ticket-1', 'admin-1', {
      content: 'تم حل المشكلة',
      internal: false,
    });

    expect(supportMessageRecieved).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ ticketId: 'ticket-1', internal: false }),
    );
    expect(notifyUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'NEW_MESSAGE' }),
    );
    expect(sendSupportReplyEmail).toHaveBeenCalledWith({
      to: 'user@example.com',
      name: 'User',
      ticketId: 'ticket-1',
      preview: 'تم حل المشكلة...',
    });
  });

  it('does not expose internal support notes by email or notification', async () => {
    await service.addAdminReply('ticket-1', 'admin-1', {
      content: 'ملاحظة داخلية',
      internal: true,
    });

    expect(sendSupportReplyEmail).not.toHaveBeenCalled();
    expect(notifyUser).not.toHaveBeenCalled();
  });
});
