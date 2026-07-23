/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest.fn() mocks + expect.objectContaining erase type info here the same way they do in admin.service.spec.ts's untyped Prisma mocks. */
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportService } from './support.service';

describe('SupportService', () => {
  const findUniqueUser = jest.fn();
  const findMany = jest.fn();
  const findUnique = jest.fn();
  const findUniqueOrThrow = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const createMessage = jest.fn();
  const transaction = jest.fn();

  const service = new SupportService({
    user: { findUnique: findUniqueUser },
    supportTicket: {
      findMany,
      findUnique,
      findUniqueOrThrow,
      create,
      update,
    },
    supportMessage: { create: createMessage },
    $transaction: transaction,
  } as unknown as PrismaService);

  const baseTicket = {
    id: 'ticket-1',
    userId: 'user-1',
    subject: 'مشكلة في الدفع',
    status: 'NEW' as const,
    assignedAdminId: null,
    createdAt: new Date('2026-07-20T10:00:00Z'),
    lastMessageAt: new Date('2026-07-20T10:00:00Z'),
    user: { fullName: 'مستأجر تجريبي' },
    assignedAdmin: null,
    messages: [
      {
        id: 'msg-1',
        author: 'AI' as const,
        authorId: null,
        authorUser: null,
        content: 'لخص المحادثة هنا',
        internal: false,
        createdAt: new Date('2026-07-20T10:00:00Z'),
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    transaction.mockImplementation(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
  });

  describe('createFromHandoff', () => {
    it('creates a ticket with the AI-authored summary as the first message', async () => {
      findUniqueUser.mockResolvedValue({ id: 'user-1' });
      create.mockResolvedValue(baseTicket);

      const result = await service.createFromHandoff({
        user_id: 'user-1',
        chat_summary: 'لخص المحادثة هنا',
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            subject: 'لخص المحادثة هنا',
            status: 'NEW',
            messages: {
              create: expect.objectContaining({
                author: 'AI',
                content: 'لخص المحادثة هنا',
                internal: false,
              }),
            },
          }),
        }),
      );
      expect(result.status).toBe('new');
      expect(result.messages[0]).toMatchObject({
        author: 'ai',
        authorName: 'المساعد الذكي',
      });
    });

    it('rejects a handoff for an unknown user', async () => {
      findUniqueUser.mockResolvedValue(null);

      await expect(
        service.createFromHandoff({
          user_id: 'missing-user',
          chat_summary: 'test',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('reply', () => {
    it('advances NEW/ASSIGNED tickets to IN_PROGRESS on a customer-facing reply', async () => {
      findUnique
        .mockResolvedValueOnce(baseTicket) // findTicketOrThrow before reply
        .mockResolvedValueOnce({
          ...baseTicket,
          status: 'IN_PROGRESS',
        }); // findTicketOrThrow after reply

      await service.reply('admin-1', 'ticket-1', {
        content: 'أهلاً، كيف أقدر أساعدك؟',
      });

      expect(transaction).toHaveBeenCalled();
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            author: 'ADMIN',
            authorId: 'admin-1',
            internal: false,
          }),
        }),
      );
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'IN_PROGRESS' }),
        }),
      );
    });

    it('does not advance status for an internal-only note', async () => {
      findUnique
        .mockResolvedValueOnce(baseTicket)
        .mockResolvedValueOnce(baseTicket);

      await service.reply('admin-1', 'ticket-1', {
        content: 'ملاحظة داخلية للفريق',
        internal: true,
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ status: expect.anything() }),
        }),
      );
    });

    it('throws 404 for a non-existent ticket', async () => {
      findUnique.mockResolvedValueOnce(null);

      await expect(
        service.reply('admin-1', 'missing', { content: 'hi' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('assign', () => {
    it('assigns a NEW ticket and flips status to ASSIGNED', async () => {
      findUnique
        .mockResolvedValueOnce(baseTicket)
        .mockResolvedValueOnce({ ...baseTicket, status: 'ASSIGNED' });

      await service.assign('admin-1', 'ticket-1');

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignedAdminId: 'admin-1',
            status: 'ASSIGNED',
          }),
        }),
      );
    });

    it('does not change status of an already-in-progress ticket', async () => {
      const inProgress = { ...baseTicket, status: 'IN_PROGRESS' as const };
      findUnique
        .mockResolvedValueOnce(inProgress)
        .mockResolvedValueOnce(inProgress);

      await service.assign('admin-1', 'ticket-1');

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignedAdminId: 'admin-1',
            status: undefined,
          }),
        }),
      );
    });
  });

  describe('setStatus', () => {
    it('maps the frontend wire status to the DB enum', async () => {
      findUnique
        .mockResolvedValueOnce(baseTicket)
        .mockResolvedValueOnce({ ...baseTicket, status: 'WAITING' });

      const result = await service.setStatus('ticket-1', 'waiting');

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'WAITING' } }),
      );
      expect(result.status).toBe('waiting');
    });
  });

  describe('listTickets', () => {
    it('maps tickets to the frontend summary shape, newest first', async () => {
      findMany.mockResolvedValue([baseTicket]);

      const result = await service.listTickets();

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { lastMessageAt: 'desc' } }),
      );
      expect(result.items[0]).toEqual({
        id: 'ticket-1',
        subject: 'مشكلة في الدفع',
        userName: 'مستأجر تجريبي',
        status: 'new',
        assignedAdminName: null,
        lastMessageAt: baseTicket.lastMessageAt.toISOString(),
        createdAt: baseTicket.createdAt.toISOString(),
      });
    });
  });
});
