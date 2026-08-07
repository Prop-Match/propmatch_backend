import { BadRequestException, ConflictException } from '@nestjs/common';
import { PartnerLeadsService } from './partner-leads.service';

describe('PartnerLeadsService', () => {
  const userId = 'd2f0d7d7-7d76-41d4-a176-f4fed746fa30';
  const createdAt = new Date('2026-07-29T09:00:00.000Z');
  const consentedAt = new Date('2026-07-29T09:00:01.000Z');
  let prisma: { partnerLead: { findFirst: jest.Mock; create: jest.Mock } };
  let realtime: { partnerLeadCreated: jest.Mock };
  let service: PartnerLeadsService;

  beforeEach(() => {
    prisma = {
      partnerLead: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    realtime = { partnerLeadCreated: jest.fn() };
    service = new PartnerLeadsService(prisma as never, realtime as never);
  });

  function mockCreatedLead(serviceType: 'MOVING' | 'INSURANCE') {
    prisma.partnerLead.create.mockResolvedValue({
      id: 'lead-id',
      userId,
      serviceType,
      status: 'PENDING',
      consentedAt,
      createdAt,
    });
  }

  it.each(['MOVING', 'INSURANCE'] as const)(
    'creates a pending %s lead using the authenticated user and explicit consent',
    async (serviceType) => {
      mockCreatedLead(serviceType);

      const result = await service.create(userId, {
        serviceType,
        consent: true,
      });

      expect(prisma.partnerLead.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          serviceType,
          status: 'PENDING',
          consentedAt: expect.any(Date),
        }),
      });
      expect(result).toEqual({
        id: 'lead-id',
        serviceType,
        status: 'PENDING',
        consentedAt: consentedAt.toISOString(),
        createdAt: createdAt.toISOString(),
      });
      expect(result).not.toHaveProperty('userId');
      expect(realtime.partnerLeadCreated).toHaveBeenCalledWith({
        leadId: 'lead-id',
        userId,
        serviceType,
        status: 'PENDING',
        createdAt,
      });
    },
  );

  it.each([undefined, false, null] as const)(
    'rejects inactive or missing consent without storing or notifying',
    async (consent) => {
      await expect(
        service.create(userId, { serviceType: 'MOVING', consent } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.partnerLead.create).not.toHaveBeenCalled();
      expect(realtime.partnerLeadCreated).not.toHaveBeenCalled();
    },
  );

  it('rejects an equivalent pending lead with a stable 409 code', async () => {
    prisma.partnerLead.findFirst.mockResolvedValue({ id: 'existing-lead' });

    await expect(
      service.create(userId, { serviceType: 'MOVING', consent: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    await service
      .create(userId, { serviceType: 'MOVING', consent: true })
      .catch((error: ConflictException) => {
        expect(error.getStatus()).toBe(409);
        expect(error.getResponse()).toMatchObject({
          code: 'PARTNER_LEAD_ALREADY_PENDING',
        });
      });
    expect(prisma.partnerLead.create).not.toHaveBeenCalled();
    expect(realtime.partnerLeadCreated).not.toHaveBeenCalled();
  });

  it('does not let a failed realtime notification undo a stored lead', async () => {
    mockCreatedLead('MOVING');
    realtime.partnerLeadCreated.mockImplementation(() => {
      throw new Error('socket unavailable');
    });

    await expect(
      service.create(userId, { serviceType: 'MOVING', consent: true }),
    ).resolves.toMatchObject({ id: 'lead-id', status: 'PENDING' });
  });
});
