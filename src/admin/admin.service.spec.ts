jest.mock(
  '@generated/prisma/enums',
  () => ({
    NotificationType: { EKYC_APPROVED: 'EKYC_APPROVED' },
  }),
  { virtual: true },
);

import type { Queue } from 'bullmq';
import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { PrivateObjectStorage } from '../storage/private-object-storage.interface';
import type { PropertyApprovalIndexingService } from '../properties/property-approval-indexing.service';
import type { MatchTenantRequestJobData } from '../matching/matching.constants';
import type { MailService } from '../mail/mail.service';

const noopQueue = {
  add: jest.fn(),
} as unknown as Queue<MatchTenantRequestJobData>;

const noopMailService = {
  sendAccountReactivatedEmail: jest.fn(),
  sendAccountReactivationRejectedEmail: jest.fn(),
} as unknown as MailService;

describe('AdminService moderation queues', () => {
  it('separates first submissions from edited properties', async () => {
    const propertyFindMany = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'new-property',
          title: 'New property',
          rentAmount: 3000,
          createdAt: new Date('2026-07-28T12:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'edited-property',
          title: 'Edited property',
          rentAmount: 4000,
          updatedAt: new Date('2026-07-29T12:00:00.000Z'),
        },
      ]);
    const service = new AdminService(
      {
        identityVerification: { findMany: jest.fn().mockResolvedValue([]) },
        property: { findMany: propertyFindMany },
        tenantRequest: { findMany: jest.fn().mockResolvedValue([]) },
        propertyReview: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService,
      {} as RealtimeService,
      {} as PrivateObjectStorage,
      {} as PropertyApprovalIndexingService,
      noopQueue,
      noopMailService,
    );

    await expect(service.getQueues()).resolves.toMatchObject({
      propertyQueue: [
        expect.objectContaining({
          subjectId: 'new-property',
          type: 'property',
        }),
      ],
      editedPropertyQueue: [
        expect.objectContaining({
          subjectId: 'edited-property',
          type: 'propertyEdit',
        }),
      ],
    });
    expect(propertyFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { status: 'PENDING', approvedAt: null },
      }),
    );
    expect(propertyFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { status: 'PENDING', approvedAt: { not: null } },
      }),
    );
  });
});

describe('AdminService KYC review', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const notifyUser = jest.fn();
  const service = new AdminService(
    {
      identityVerification: { findUnique, update },
      adminAuditLogEntry: { create: jest.fn() },
    } as unknown as PrismaService,
    { notifyUser } as unknown as RealtimeService,
    {} as PrivateObjectStorage,
    {} as PropertyApprovalIndexingService,
    noopQueue,
    noopMailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({ status: 'PENDING' });
    update.mockResolvedValue({});
    notifyUser.mockResolvedValue({});
  });

  it('requests corrected documents instead of permanently rejecting KYC', async () => {
    await service.reviewKyc('admin-1', 'user-1', {
      decision: 'reject',
      reason: 'الصورة غير واضحة',
    });

    expect(update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        status: 'RESUBMISSION_REQUIRED',
        reviewedBy: 'admin-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        reviewedAt: expect.any(Date),
        rejectionReason: 'الصورة غير واضحة',
      }),
    });
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('preserves the approved KYC behavior', async () => {
    await service.reviewKyc('admin-1', 'user-1', {
      decision: 'approve',
    });

    expect(update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        status: 'APPROVED',
        reviewedBy: 'admin-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        reviewedAt: expect.any(Date),
        rejectionReason: null,
      }),
    });
    expect(notifyUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'EKYC_APPROVED' }),
    );
  });
});

describe('AdminService property moderation', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const notifyUser = jest.fn();
  const indexApprovedProperty = jest.fn();
  const logIndexingFailure = jest.fn();
  const service = new AdminService(
    {
      property: { findUnique, update },
      adminAuditLogEntry: { create: jest.fn() },
      $transaction: (
        callback: (tx: {
          property: { update: typeof update };
        }) => Promise<unknown>,
      ) => callback({ property: { update } }),
    } as unknown as PrismaService,
    { notifyUser } as unknown as RealtimeService,
    {} as PrivateObjectStorage,
    {
      indexApprovedProperty,
      logIndexingFailure,
    } as unknown as PropertyApprovalIndexingService,
    noopQueue,
    noopMailService,
  );

  const property = {
    id: 'property-1',
    title: 'Moderated apartment',
    description: 'A complete listing description.',
    governorate: 'Cairo',
    city: 'Cairo',
    district: 'Maadi',
    manualAddress: 'Test street',
    propertyType: 'APARTMENT',
    rentAmount: 5000,
    areaM2: 100,
    bedrooms: 2,
    bathrooms: 1,
    isFurnished: true,
    hasElevator: true,
    hasParking: false,
    propertyAroundServices: 'Metro',
    status: 'PENDING',
    createdAt: new Date('2026-07-21T12:00:00.000Z'),
    ownerId: 'owner-1',
    owner: {
      fullName: 'Verified landlord',
      identityVerification: { status: 'APPROVED' },
    },
    propertyImages: [
      {
        id: 'image-1',
        imageUrl: 'https://example.test/1.jpg',
        displayOrder: 0,
        isCover: true,
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue(property);
    update.mockResolvedValue(property);
    notifyUser.mockResolvedValue({});
    indexApprovedProperty.mockResolvedValue(undefined);
  });

  it('returns a safe, complete property review detail', async () => {
    const result = await service.getPropertyReviewDetail('property-1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'property-1',
        ownerName: 'Verified landlord',
        ownerVerificationStatus: 'APPROVED',
        images: property.propertyImages,
      }),
    );
    expect(result).not.toHaveProperty('owner');
    expect(result).not.toHaveProperty('propertyImages');
  });

  it('returns not found when the review property does not exist', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(
      service.getPropertyReviewDetail('missing'),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('approves a pending property', async () => {
    update.mockResolvedValueOnce({ ...property, status: 'APPROVED' });
    await expect(
      service.reviewProperty('admin-1', 'property-1', { decision: 'approve' }),
    ).resolves.toMatchObject({ status: 'APPROVED' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ status: 'APPROVED' }),
      }),
    );
    expect(indexApprovedProperty).toHaveBeenCalledWith('property-1');
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(
      indexApprovedProperty.mock.invocationCallOrder[0],
    );
  });

  it('rejects a pending property with a reason', async () => {
    await expect(
      service.reviewProperty('admin-1', 'property-1', {
        decision: 'reject',
        reason: 'Missing required photos',
      }),
    ).resolves.toMatchObject({ status: 'REJECTED' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ status: 'REJECTED' }),
      }),
    );
    expect(indexApprovedProperty).not.toHaveBeenCalled();
  });

  it('requires a reason to reject a property', async () => {
    await expect(
      service.reviewProperty('admin-1', 'property-1', { decision: 'reject' }),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
    expect(indexApprovedProperty).not.toHaveBeenCalled();
  });

  it('does not review a property that has already been reviewed', async () => {
    findUnique.mockResolvedValueOnce({ ...property, status: 'APPROVED' });
    await expect(
      service.reviewProperty('admin-1', 'property-1', { decision: 'approve' }),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
    expect(indexApprovedProperty).not.toHaveBeenCalled();
  });

  it('keeps an approved property when indexing fails', async () => {
    update.mockResolvedValueOnce({ ...property, status: 'APPROVED' });
    indexApprovedProperty.mockRejectedValueOnce(new Error('provider failed'));

    await expect(
      service.reviewProperty('admin-1', 'property-1', { decision: 'approve' }),
    ).resolves.toMatchObject({ status: 'APPROVED' });

    expect(update).toHaveBeenCalledTimes(1);
    expect(logIndexingFailure).toHaveBeenCalledWith(
      'property-1',
      expect.any(Error),
    );
  });

  it('does not index when the approval transaction fails', async () => {
    update.mockRejectedValueOnce(new Error('database failure'));

    await expect(
      service.reviewProperty('admin-1', 'property-1', { decision: 'approve' }),
    ).rejects.toThrow('database failure');

    expect(indexApprovedProperty).not.toHaveBeenCalled();
  });
});

describe('AdminService.softDeleteUser', () => {
  const findUnique = jest.fn();
  const userUpdate = jest.fn();
  const tenantRequestUpdateMany = jest.fn();
  const propertyUpdateMany = jest.fn();
  const $transaction = jest.fn();
  const create = jest.fn();
  const forceLogoutUser = jest.fn();
  const service = new AdminService(
    {
      user: { findUnique, update: userUpdate },
      tenantRequest: { updateMany: tenantRequestUpdateMany },
      property: { updateMany: propertyUpdateMany },
      $transaction,
      adminAuditLogEntry: { create },
    } as unknown as PrismaService,
    { forceLogoutUser } as unknown as RealtimeService,
    {} as PrivateObjectStorage,
    {} as PropertyApprovalIndexingService,
    noopQueue,
    noopMailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    userUpdate.mockResolvedValue({});
    tenantRequestUpdateMany.mockResolvedValue({ count: 0 });
    propertyUpdateMany.mockResolvedValue({ count: 0 });
    $transaction.mockResolvedValue([]);
    create.mockResolvedValue({});
  });

  it('soft-deletes a tenant, archives their requests, and force-logs-out their live socket', async () => {
    findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'TENANT',
      deletedAt: null,
      adminRole: null,
    });

    await expect(service.softDeleteUser('admin-1', 'user-1')).resolves.toEqual({
      success: true,
      id: 'user-1',
    });

    expect(forceLogoutUser).toHaveBeenCalledWith('user-1');
    expect($transaction).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.anything(),
        expect.anything(),
        expect.anything(),
      ]),
    );
    expect(create).toHaveBeenCalledWith({
      data: { actorId: 'admin-1', action: 'user:delete', subjectId: 'user-1' },
    });
  });

  it('rejects deleting a user that does not exist', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      service.softDeleteUser('admin-1', 'missing'),
    ).rejects.toMatchObject({ status: 404 });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('rejects deleting an already-deleted user', async () => {
    findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'TENANT',
      deletedAt: new Date(),
      adminRole: null,
    });

    await expect(
      service.softDeleteUser('admin-1', 'user-1'),
    ).rejects.toMatchObject({ status: 409 });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('refuses to delete an admin account', async () => {
    findUnique.mockResolvedValue({
      id: 'admin-2',
      role: 'ADMIN',
      deletedAt: null,
      adminRole: 'READ_ONLY',
    });

    await expect(
      service.softDeleteUser('admin-1', 'admin-2'),
    ).rejects.toMatchObject({ status: 403 });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('refuses to let an admin delete their own account', async () => {
    findUnique.mockResolvedValue({
      id: 'admin-1',
      role: 'TENANT',
      deletedAt: null,
      adminRole: null,
    });

    await expect(
      service.softDeleteUser('admin-1', 'admin-1'),
    ).rejects.toMatchObject({ status: 403 });
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe('AdminService.approveReactivation / rejectReactivation', () => {
  const findUnique = jest.fn();
  const userUpdate = jest.fn();
  const activationRequestUpdate = jest.fn();
  const $transaction = jest.fn();
  const create = jest.fn();
  const notifyUser = jest.fn();
  const sendAccountReactivatedEmail = jest.fn();
  const sendAccountReactivationRejectedEmail = jest.fn();
  const service = new AdminService(
    {
      activationRequest: { findUnique, update: activationRequestUpdate },
      user: { update: userUpdate },
      $transaction,
      adminAuditLogEntry: { create },
    } as unknown as PrismaService,
    { notifyUser } as unknown as RealtimeService,
    {} as PrivateObjectStorage,
    {} as PropertyApprovalIndexingService,
    noopQueue,
    {
      sendAccountReactivatedEmail,
      sendAccountReactivationRejectedEmail,
    } as unknown as MailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    userUpdate.mockResolvedValue({});
    activationRequestUpdate.mockResolvedValue({});
    $transaction.mockResolvedValue([]);
    create.mockResolvedValue({});
    notifyUser.mockResolvedValue({});
    sendAccountReactivatedEmail.mockResolvedValue(undefined);
    sendAccountReactivationRejectedEmail.mockResolvedValue(undefined);
  });

  it('approves: bumps tokenVersion, clears deletedAt, marks the request APPROVED, notifies and emails the user', async () => {
    findUnique.mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: 'PENDING',
      user: { fullName: 'Test User', email: 'user@example.com' },
    });

    await expect(
      service.approveReactivation('admin-1', 'req-1'),
    ).resolves.toEqual({ success: true, id: 'req-1' });

    expect($transaction).toHaveBeenCalledWith(
      expect.arrayContaining([expect.anything(), expect.anything()]),
    );
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-1',
        action: 'user:reactivate:approve',
        subjectId: 'user-1',
      },
    });
    expect(notifyUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'ACCOUNT_REACTIVATED' }),
    );
    expect(sendAccountReactivatedEmail).toHaveBeenCalledWith(
      'user@example.com',
    );
  });

  it('does not touch the user or audit log for a request that is not PENDING', async () => {
    findUnique.mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: 'APPROVED',
      user: { fullName: 'Test User', email: 'user@example.com' },
    });

    await expect(
      service.approveReactivation('admin-1', 'req-1'),
    ).rejects.toMatchObject({ status: 409 });
    expect($transaction).not.toHaveBeenCalled();
    expect(notifyUser).not.toHaveBeenCalled();
    expect(sendAccountReactivatedEmail).not.toHaveBeenCalled();
  });

  it('404s approval of a request that does not exist', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      service.approveReactivation('admin-1', 'missing'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects: marks the request REJECTED without touching the user, notifies and emails the user', async () => {
    findUnique.mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: 'PENDING',
      user: { fullName: 'Test User', email: 'user@example.com' },
    });
    activationRequestUpdate.mockResolvedValue({});

    await expect(
      service.rejectReactivation('admin-1', 'req-1'),
    ).resolves.toEqual({ success: true, id: 'req-1' });

    expect(activationRequestUpdate).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { status: 'REJECTED' },
    });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(notifyUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'ACCOUNT_REACTIVATION_REJECTED' }),
    );
    expect(sendAccountReactivationRejectedEmail).toHaveBeenCalledWith(
      'user@example.com',
    );
  });
});

describe('AdminService.anonymizeExpiredUsers', () => {
  const findMany = jest.fn();
  const upd = jest.fn();
  const service = new AdminService(
    {
      user: { findMany, update: upd },
    } as unknown as PrismaService,
    {} as RealtimeService,
    {} as PrivateObjectStorage,
    {} as PropertyApprovalIndexingService,
    noopQueue,
    noopMailService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('does nothing when there are no expired candidates', async () => {
    findMany.mockResolvedValue([]);
    await service.anonymizeExpiredUsers();
    expect(upd).not.toHaveBeenCalled();
  });

  it("processes every candidate even when some updates fail (one bad row can't stall the rest)", async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({
      id: `user-${i}`,
    }));
    findMany.mockResolvedValue(candidates);
    upd.mockImplementation(({ where }: { where: { id: string } }) =>
      where.id === 'user-2'
        ? Promise.reject(new Error('database failure'))
        : Promise.resolve({}),
    );

    await service.anonymizeExpiredUsers();

    expect(upd).toHaveBeenCalledTimes(5);
    candidates.forEach(
      (c) =>
        /* eslint-disable @typescript-eslint/no-unsafe-assignment */
        expect(upd).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: c.id },
            data: expect.objectContaining({
              fullName: 'Deleted User',
              email: expect.stringMatching(/^deleted-.+@propmatch\.local$/),
              passwordHash: expect.any(String),
              phoneNumber: expect.stringMatching(/^deleted-/),
              avatarUrl: null,
              resetToken: null,
              resetTokenExpiry: null,
            }),
          }),
        ),
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    );
  });
});

describe('AdminService.listUsers', () => {
  const findMany = jest.fn();
  const count = jest.fn();
  const service = new AdminService(
    {
      user: { findMany, count },
    } as unknown as PrismaService,
    {} as RealtimeService,
    {} as PrivateObjectStorage,
    {} as PropertyApprovalIndexingService,
    noopQueue,
    noopMailService,
  );

  const row = {
    id: 'user-1',
    fullName: 'Test User',
    email: 'user@example.com',
    phoneNumber: '01000000000',
    role: 'TENANT',
    isActive: true,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    deletedAt: null as Date | null,
    suspendedAt: null as Date | null,
    suspendedUntil: null as Date | null,
    suspensionReason: null as string | null,
    suspensionNote: null as string | null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([row]);
    count.mockResolvedValue(1);
  });

  it('defaults to active, non-admin users only (deletedAt: null)', async () => {
    await service.listUsers();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { not: 'ADMIN' }, deletedAt: null },
      }),
    );
  });

  it('filters to deleted users when status=deleted', async () => {
    await service.listUsers({ status: 'deleted' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { not: 'ADMIN' }, deletedAt: { not: null } },
      }),
    );
  });

  it('applies no deletedAt filter when status=all', async () => {
    await service.listUsers({ status: 'all' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: { not: 'ADMIN' } } }),
    );
  });

  it('searches by name/email/phone when search is provided', async () => {
    await service.listUsers({ status: 'all', search: 'ali' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        where: expect.objectContaining({
          OR: [
            { fullName: { contains: 'ali', mode: 'insensitive' } },
            { email: { contains: 'ali', mode: 'insensitive' } },
            { phoneNumber: { contains: 'ali' } },
          ],
        }),
      }),
    );
  });

  it('includes deletedAt in the mapped response', async () => {
    findMany.mockResolvedValue([
      { ...row, id: 'user-2', deletedAt: new Date('2026-07-15T00:00:00.000Z') },
    ]);
    await expect(service.listUsers({ status: 'deleted' })).resolves.toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            id: 'user-2',
            deletedAt: '2026-07-15T00:00:00.000Z',
          }),
        ],
      }),
    );
  });
});
