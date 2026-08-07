import { OffersService } from './offers.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

describe('OffersService agreement flow', () => {
  it('opens discussion without fulfilling the request or rejecting competing offers', async () => {
    const request = {
      id: 'request-id',
      tenantId: 'tenant-id',
      status: 'APPROVED',
    };
    const property = {
      id: 'property-id',
      status: 'APPROVED',
      manualAddress: 'Address',
    };
    const offer = {
      id: 'offer-id',
      tenantRequestId: request.id,
      propertyId: property.id,
      ownerId: 'owner-id',
      status: 'VIEWED',
    };
    const connection = { id: 'connection-id' };
    const tx = {
      tenantRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: request.id }),
      },
      ownerOffer: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      matchConnection: { create: jest.fn().mockResolvedValue(connection) },
    };
    const prisma = {
      ownerOffer: { findFirst: jest.fn().mockResolvedValue(offer) },
      property: { findUnique: jest.fn().mockResolvedValue(property) },
      tenantRequest: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(request),
      },
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ fullName: 'Owner', phoneNumber: '01000000000' }),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const realtime = { notifyUser: jest.fn().mockResolvedValue(undefined) };
    const service = new OffersService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
      { minSimilarity: 0.65 },
    );
    Object.defineProperty(service, 'computeHybridMatch', {
      value: jest.fn().mockReturnValue({ score: 92, reasons: [] }),
    });

    await expect(
      service.acceptOffer(request.tenantId, offer.id),
    ).resolves.toEqual(
      expect.objectContaining({ matchConnectionId: connection.id }),
    );

    expect(tx.matchConnection.create).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        tenantRequestId: request.id,
        status: 'CONNECTED',
      }),
    });
    expect(tx.ownerOffer.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.tenantRequest).not.toHaveProperty('updateMany');
  });
});
