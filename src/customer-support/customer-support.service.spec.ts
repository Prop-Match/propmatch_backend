import { CustomerSupportService } from './customer-support.service';

describe('CustomerSupportService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    supportTicket: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    supportMessage: { create: jest.fn() },
  };
  const realtime = {
    supportTicketCreated: jest.fn(),
    notifyUsers: jest.fn().mockResolvedValue([]),
    supportMessageToAdmins: jest.fn(),
  };
  const service = new CustomerSupportService(
    prisma as never,
    realtime as never,
    {} as never,
    {} as never,
  );
  const user = { id: 'user-1', fullName: 'Suspended User' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates one high-priority support ticket and notifies admins', async () => {
    prisma.supportTicket.findFirst.mockResolvedValue(null);
    prisma.supportTicket.create.mockResolvedValue({
      id: 'ticket-1',
      status: 'NEW',
      priority: 'HIGH',
      createdAt: new Date('2026-08-09T10:00:00.000Z'),
    });

    await expect(
      service.createSuspensionAppeal(user, 'Please review my suspension.'),
    ).resolves.toEqual({
      id: 'ticket-1',
      kind: 'SUSPENSION_APPEAL',
      status: 'new',
    });
    expect(prisma.supportTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: user.id,
          priority: 'HIGH',
          escalationReason: 'طلب مراجعة إيقاف الحساب',
        }),
      }),
    );
    expect(realtime.supportTicketCreated).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 'ticket-1', priority: 'HIGH' }),
    );
  });

  it('returns the existing open appeal instead of creating a duplicate', async () => {
    prisma.supportTicket.findFirst.mockResolvedValue({
      id: 'ticket-existing',
      status: 'IN_PROGRESS',
    });

    await expect(service.createSuspensionAppeal(user)).resolves.toEqual({
      id: 'ticket-existing',
      kind: 'SUSPENSION_APPEAL',
      status: 'in_progress',
    });
    expect(prisma.supportTicket.create).not.toHaveBeenCalled();
    expect(realtime.supportTicketCreated).not.toHaveBeenCalled();
  });

  it('filters the admin queue by status and commercial tier before paginating', async () => {
    const future = new Date('2099-01-01T00:00:00.000Z');
    const ticket = (
      id: string,
      planType: 'FREE' | 'PREMIUM',
      priority: string,
    ) => ({
      id,
      escalationReason: null,
      status: 'CLOSED',
      priority,
      assignedAdmin: null,
      lastMessageAt: new Date('2026-08-09T10:00:00.000Z'),
      createdAt: new Date('2026-08-08T10:00:00.000Z'),
      messages: [{ content: `Ticket ${id}` }],
      user: {
        fullName: `User ${id}`,
        userQuota: { planType, planExpiresAt: future },
      },
    });
    prisma.supportTicket.findMany.mockResolvedValue([
      ticket('premium-high', 'PREMIUM', 'HIGH'),
      ticket('free', 'FREE', 'CRITICAL'),
      ticket('premium-normal', 'PREMIUM', 'NORMAL'),
    ]);

    await expect(
      service.getAdminTickets({
        status: 'closed',
        commercialPriority: 'premium',
        page: 2,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({
      items: [{ id: 'premium-normal', commercialPriority: 'PREMIUM' }],
      total: 2,
      page: 2,
      pageSize: 1,
    });
    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'CLOSED' } }),
    );
  });

  it('rejects unknown admin queue filters', async () => {
    await expect(
      service.getAdminTickets({ status: 'missing' }),
    ).rejects.toThrow('Invalid support ticket status');
    expect(prisma.supportTicket.findMany).not.toHaveBeenCalled();
  });

  describe('automatic escalations', () => {
    const input = {
      agentRunId: '00000000-0000-4000-8000-000000000001',
      message: 'أريد التحدث مع موظف دعم',
      reason: 'طلب المستخدم التحدث مع موظف دعم فني بشكل صريح',
      priority: 'HIGH' as const,
    };

    const ticket = {
      id: 'ticket-auto-1',
      userId: 'user-1',
      status: 'NEW',
      priority: 'HIGH',
      escalationReason: input.reason,
      aiSummary: input.reason,
      assignedAdminId: null,
      assignedAdmin: null,
      lastMessageAt: new Date('2026-08-09T10:00:00.000Z'),
      createdAt: new Date('2026-08-09T10:00:00.000Z'),
      user: { fullName: 'Support User' },
      messages: [
        {
          id: 'message-1',
          authorType: 'USER',
          authorName: 'Support User',
          authorId: 'user-1',
          content: input.message,
          internal: false,
          createdAt: new Date('2026-08-09T10:00:00.000Z'),
        },
      ],
    };

    beforeEach(() => {
      prisma.supportTicket.findUnique.mockResolvedValue(null);
      prisma.supportTicket.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        fullName: 'Support User',
      });
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
      prisma.supportTicket.create.mockResolvedValue(ticket);
    });

    it('creates and broadcasts an automatic ticket once', async () => {
      const result = await service.createAgentEscalation('user-1', input);

      expect(result.id).toBe('ticket-auto-1');
      expect(prisma.supportTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentEscalationKey: input.agentRunId,
            priority: 'HIGH',
            messages: {
              create: expect.objectContaining({
                authorType: 'USER',
                authorId: 'user-1',
              }),
            },
          }),
        }),
      );
      expect(realtime.supportTicketCreated).toHaveBeenCalledTimes(1);
      expect(realtime.notifyUsers).toHaveBeenCalledWith([
        expect.objectContaining({
          userId: 'admin-1',
          type: 'SUPPORT_TICKET_ESCALATED',
          link: '/admin/tickets/ticket-auto-1',
        }),
      ]);
    });

    it('returns the idempotent ticket without creating or broadcasting again', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(ticket);

      const result = await service.createAgentEscalation('user-1', input);

      expect(result.id).toBe('ticket-auto-1');
      expect(prisma.supportTicket.create).not.toHaveBeenCalled();
      expect(realtime.supportTicketCreated).not.toHaveBeenCalled();
    });

    it('reuses an existing open ticket instead of flooding the queue', async () => {
      prisma.supportTicket.findFirst.mockResolvedValue(ticket);
      prisma.supportMessage.create.mockResolvedValue({
        authorName: 'Support User',
        content: input.message,
        createdAt: new Date('2026-08-09T10:01:00.000Z'),
      });

      const result = await service.createAgentEscalation('user-1', input);

      expect(result.id).toBe('ticket-auto-1');
      expect(prisma.supportTicket.create).not.toHaveBeenCalled();
      expect(realtime.supportTicketCreated).not.toHaveBeenCalled();
      expect(prisma.supportMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ticketId: 'ticket-auto-1' }),
        }),
      );
      expect(realtime.supportMessageToAdmins).toHaveBeenCalledWith(
        expect.objectContaining({ ticketId: 'ticket-auto-1', content: input.message }),
      );
    });
  });
});
