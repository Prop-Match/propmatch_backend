import { CustomerSupportService } from './customer-support.service';

describe('CustomerSupportService suspension appeals', () => {
  const prisma = {
    supportTicket: {
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
});
