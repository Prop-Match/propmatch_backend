import { ConflictException, NotFoundException } from '@nestjs/common';
import { MessagesService } from './messages.service';

describe('MessagesService agreement confirmation', () => {
  const connection = {
    id: 'connection-id',
    tenantId: 'tenant-id',
    ownerId: 'owner-id',
    propertyId: 'property-id',
    tenantRequestId: 'request-id',
    agreementReachedAt: null,
  };

  function setup(overrides: Partial<typeof connection> = {}) {
    const selected = { ...connection, ...overrides };
    const tx = {
      matchConnection: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
      },
      tenantRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      ownerOffer: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      tenantOffer: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      property: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      matchConnection: { findFirst: jest.fn().mockResolvedValue(selected) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const realtime = { notifyUser: jest.fn().mockResolvedValue(undefined) };
    const chroma = { remove: jest.fn().mockResolvedValue(undefined) };
    const embeddings = {
      isLocalEmbeddingEnabled: jest.fn().mockReturnValue(false),
    };
    const service = new MessagesService(
      prisma as never,
      realtime as never,
      {} as never,
      chroma as never,
      embeddings as never,
    );
    return { service, prisma, realtime, tx, chroma };
  }

  it('atomically confirms the match, fulfils its request, and closes pending offers', async () => {
    const { service, realtime, tx, chroma } = setup();
    const result = await service.confirmAgreement('tenant-id', connection.id);

    expect(tx.matchConnection.updateMany).toHaveBeenCalledWith({
      where: {
        id: connection.id,
        agreementReachedAt: null,
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: { agreementReachedAt: expect.any(Date) },
    });
    expect(tx.tenantRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: connection.tenantRequestId,
        tenantId: 'tenant-id',
        status: 'APPROVED',
      },
      data: { status: 'FULFILLED' },
    });
    expect(tx.ownerOffer.updateMany).toHaveBeenCalledWith({
      where: {
        tenantRequestId: connection.tenantRequestId,
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: { status: 'REJECTED' },
    });
    expect(tx.property.updateMany).toHaveBeenCalledWith({
      where: { id: connection.propertyId, status: { not: 'ARCHIVED' } },
      data: { status: 'ARCHIVED' },
    });
    expect(chroma.remove).toHaveBeenCalledWith(
      'cohere',
      `property:${connection.propertyId}`,
    );
    expect(result.agreementReachedAt).toEqual(expect.any(String));
    expect(realtime.notifyUser).toHaveBeenCalledWith(
      connection.ownerId,
      expect.objectContaining({ link: `/landlord/messages/${connection.id}` }),
    );
  });

  it('lets the landlord confirm a direct-listing match and archive the property', async () => {
    const { service, tx } = setup({ tenantRequestId: null });
    await service.confirmAgreement('owner-id', connection.id);
    expect(tx.tenantRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.property.updateMany).toHaveBeenCalled();
  });

  it('rejects the wrong party for the offer direction', async () => {
    const direct = setup({ tenantRequestId: null });
    await expect(
      direct.service.confirmAgreement('tenant-id', connection.id),
    ).rejects.toThrow(ConflictException);

    const reverse = setup();
    await expect(
      reverse.service.confirmAgreement('owner-id', connection.id),
    ).rejects.toThrow(ConflictException);
  });

  it('is idempotent after confirmation', async () => {
    const reachedAt = new Date('2026-08-07T20:00:00.000Z');
    const { service, prisma, realtime } = setup({
      agreementReachedAt: reachedAt,
    });
    await expect(
      service.confirmAgreement('tenant-id', connection.id),
    ).resolves.toEqual({
      matchConnectionId: connection.id,
      agreementReachedAt: reachedAt.toISOString(),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(realtime.notifyUser).not.toHaveBeenCalled();
  });

  it('handles concurrent confirmation without sending a duplicate notification', async () => {
    const reachedAt = new Date('2026-08-07T20:00:00.000Z');
    const { service, tx, realtime } = setup();
    tx.matchConnection.updateMany.mockResolvedValueOnce({ count: 0 });
    tx.matchConnection.findUnique.mockResolvedValueOnce({
      agreementReachedAt: reachedAt,
    });

    await expect(
      service.confirmAgreement('tenant-id', connection.id),
    ).resolves.toEqual({
      matchConnectionId: connection.id,
      agreementReachedAt: reachedAt.toISOString(),
    });
    expect(tx.tenantRequest.updateMany).not.toHaveBeenCalled();
    expect(realtime.notifyUser).not.toHaveBeenCalled();
  });

  it('rejects non-parties and rolls back when the request was settled elsewhere', async () => {
    const missing = setup();
    missing.prisma.matchConnection.findFirst.mockResolvedValueOnce(null);
    await expect(
      missing.service.confirmAgreement('other-user', connection.id),
    ).rejects.toThrow(NotFoundException);

    const raced = setup();
    raced.tx.tenantRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      raced.service.confirmAgreement('tenant-id', connection.id),
    ).rejects.toThrow(ConflictException);
    expect(raced.realtime.notifyUser).not.toHaveBeenCalled();
  });
});
