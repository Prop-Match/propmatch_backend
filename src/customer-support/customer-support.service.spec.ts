import { CustomerSupportService } from './customer-support.service';

describe('CustomerSupportService suspension appeals', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    supportTicket: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
  const realtime = { supportTicketCreated: jest.fn() };
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

      const result = await service.createAgentEscalation('user-1', input);

      expect(result.id).toBe('ticket-auto-1');
      expect(prisma.supportTicket.create).not.toHaveBeenCalled();
      expect(realtime.supportTicketCreated).not.toHaveBeenCalled();
    });
  });
});
