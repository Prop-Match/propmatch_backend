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

const noopQueue = {
  add: jest.fn(),
} as unknown as Queue<MatchTenantRequestJobData>;

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
