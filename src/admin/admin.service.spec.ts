jest.mock(
  '@generated/prisma/enums',
  () => ({
    NotificationType: { EKYC_APPROVED: 'EKYC_APPROVED' },
  }),
  { virtual: true },
);

import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { PrivateObjectStorage } from '../storage/private-object-storage.interface';

describe('AdminService KYC review', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const notifyUser = jest.fn();
  const service = new AdminService(
    {
      identityVerification: { findUnique, update },
    } as unknown as PrismaService,
    { notifyUser } as unknown as RealtimeService,
    {} as PrivateObjectStorage,
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
