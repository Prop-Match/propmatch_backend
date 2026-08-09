import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserReviewsService } from './user-reviews.service';

describe('UserReviewsService', () => {
  const prisma = {
    leaseContract: { findUnique: jest.fn() },
    userReview: {
      findUnique: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  };
  const realtime = { notifyUser: jest.fn() };
  const service = new UserReviewsService(prisma as never, realtime as never);

  const approvedContract = {
    status: 'APPROVED',
    matchConnection: {
      tenantId: 'tenant-1',
      ownerId: 'owner-1',
      tenant: { fullName: 'Tenant' },
      owner: { fullName: 'Owner' },
    },
  };
  const emptySummary = {
    _count: { _all: 0 },
    _avg: {
      overallRating: null,
      communicationRating: null,
      responsivenessRating: null,
      propertyAccuracyRating: null,
      commitmentRating: null,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.leaseContract.findUnique.mockResolvedValue(approvedContract);
    prisma.userReview.findUnique.mockResolvedValue(null);
    prisma.userReview.aggregate.mockResolvedValue(emptySummary);
    realtime.notifyUser.mockResolvedValue({});
  });

  it('reports the tenant-to-landlord review status from contract parties', async () => {
    await expect(
      service.statusForContract('tenant-1', 'contract-1'),
    ).resolves.toMatchObject({
      eligible: true,
      submitted: false,
      direction: 'TENANT_TO_LANDLORD',
      revieweeId: 'owner-1',
      revieweeName: 'Owner',
      receivedSummary: { total: 0 },
    });
  });

  it('creates the tenant metrics and notifies the landlord', async () => {
    prisma.userReview.create.mockResolvedValue({
      id: 'review-1',
      direction: 'TENANT_TO_LANDLORD',
      overallRating: 5,
      communicationRating: 4,
      responsivenessRating: 4,
      propertyAccuracyRating: 5,
      commitmentRating: null,
      createdAt: new Date('2026-08-09T12:00:00.000Z'),
    });

    await service.create('tenant-1', 'contract-1', {
      overallRating: 5,
      communicationRating: 4,
      responsivenessRating: 4,
      propertyAccuracyRating: 5,
    });

    expect(prisma.userReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leaseContractId: 'contract-1',
        reviewerId: 'tenant-1',
        revieweeId: 'owner-1',
        direction: 'TENANT_TO_LANDLORD',
        propertyAccuracyRating: 5,
        commitmentRating: null,
      }),
    });
    expect(realtime.notifyUser).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ type: 'USER_REVIEW_RECEIVED' }),
    );
  });

  it('requires the role-specific metric', async () => {
    await expect(
      service.create('tenant-1', 'contract-1', {
        overallRating: 5,
        communicationRating: 4,
        responsivenessRating: 4,
        commitmentRating: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userReview.create).not.toHaveBeenCalled();
  });

  it('requires an approved contract and prevents duplicate reviews', async () => {
    prisma.leaseContract.findUnique.mockResolvedValueOnce({
      ...approvedContract,
      status: 'DRAFTING',
    });
    await expect(
      service.create('owner-1', 'contract-1', {
        overallRating: 5,
        communicationRating: 5,
        responsivenessRating: 5,
        commitmentRating: 5,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.userReview.findUnique.mockResolvedValueOnce({ id: 'review-1' });
    await expect(
      service.create('owner-1', 'contract-1', {
        overallRating: 5,
        communicationRating: 5,
        responsivenessRating: 5,
        commitmentRating: 5,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
