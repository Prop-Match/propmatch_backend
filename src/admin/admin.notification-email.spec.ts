import type { Queue } from 'bullmq';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import type { MatchTenantRequestJobData } from '../matching/matching.constants';
import type { PropertyApprovalIndexingService } from '../properties/property-approval-indexing.service';
import type { RealtimeService } from '../realtime/realtime.service';
import type { PrivateObjectStorage } from '../storage/private-object-storage.interface';
import { AdminService } from './admin.service';

const queueAdd = jest.fn();
const queue = { add: queueAdd } as unknown as Queue<MatchTenantRequestJobData>;

function mailMock() {
  return {
    sendKycReviewEmail: jest.fn(),
    sendPropertyReviewEmail: jest.fn(),
    sendTenantRequestReviewEmail: jest.fn(),
    sendUserReviewDecisionEmail: jest.fn(),
    sendAccountSuspendedEmail: jest.fn(),
    sendAccountUnsuspendedEmail: jest.fn(),
    sendAccountDeletedEmail: jest.fn(),
    sendAccountReactivatedEmail: jest.fn(),
    sendAccountReactivationRejectedEmail: jest.fn(),
    sendSupportReplyEmail: jest.fn(),
    sendAdminWelcomeEmail: jest.fn(),
    sendAdminAccountUpdatedEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
  };
}

function createService(
  prisma: Partial<PrismaService>,
  realtime: Partial<RealtimeService>,
  mail: ReturnType<typeof mailMock>,
) {
  return new AdminService(
    prisma as PrismaService,
    realtime as RealtimeService,
    {} as PrivateObjectStorage,
    {
      indexApprovedProperty: jest.fn(),
      logIndexingFailure: jest.fn(),
    } as unknown as PropertyApprovalIndexingService,
    queue,
    mail as unknown as MailService,
  );
}

describe('AdminService email notifications for moderation and enforcement', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emails the tenant after approving a housing request without changing realtime delivery', async () => {
    const mail = mailMock();
    const notifyUser = jest.fn().mockResolvedValue({});
    const request = {
      id: 'request-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      tenant: { email: 'tenant@example.com', fullName: 'Tenant' },
    };
    const update = jest.fn().mockResolvedValue({
      id: request.id,
      tenantId: request.tenantId,
      status: 'APPROVED',
    });
    const service = createService(
      {
        tenantRequest: {
          findUnique: jest.fn().mockResolvedValue(request),
          update,
        },
        adminAuditLogEntry: { create: jest.fn() },
      } as unknown as PrismaService,
      { notifyUser },
      mail,
    );

    await service.reviewRequest('admin-1', request.id, {
      decision: 'approve',
    });

    expect(notifyUser).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ type: 'TENANT_REQUEST_APPROVED' }),
    );
    expect(mail.sendTenantRequestReviewEmail).toHaveBeenCalledWith({
      to: 'tenant@example.com',
      name: 'Tenant',
      approved: true,
      reason: undefined,
    });
  });

  it('emails the review author after a rejected review', async () => {
    const mail = mailMock();
    const notifyUser = jest.fn().mockResolvedValue({});
    const review = {
      id: 'review-1',
      reviewerId: 'user-1',
      propertyId: 'property-1',
      status: 'PENDING',
      reviewer: { email: 'reviewer@example.com', fullName: 'Reviewer' },
    };
    const service = createService(
      {
        propertyReview: {
          findUnique: jest.fn().mockResolvedValue(review),
          update: jest.fn().mockResolvedValue({
            ...review,
            status: 'REJECTED',
          }),
        },
        adminAuditLogEntry: { create: jest.fn() },
      } as unknown as PrismaService,
      { notifyUser },
      mail,
    );

    await service.reviewUserReview(
      'admin-1',
      { decision: 'reject', reason: 'محتوى غير مناسب' },
      review.id,
    );

    expect(notifyUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'REVIEW_REJECTED' }),
    );
    expect(mail.sendUserReviewDecisionEmail).toHaveBeenCalledWith({
      to: 'reviewer@example.com',
      name: 'Reviewer',
      approved: false,
      propertyId: 'property-1',
      reason: 'محتوى غير مناسب',
    });
  });

  it('keeps the suspension websocket push and queues a detailed email', async () => {
    const mail = mailMock();
    const emitAccountSuspended = jest.fn();
    const updated = {
      id: 'user-1',
      fullName: 'User',
      email: 'user@example.com',
      phoneNumber: '01000000000',
      role: 'TENANT',
      isActive: true,
      createdAt: new Date(),
      suspendedAt: new Date(),
      suspendedUntil: null,
      suspensionReason: 'SPAM',
      suspensionNote: 'Repeated spam',
    };
    const service = createService(
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            role: 'TENANT',
          }),
          update: jest.fn().mockResolvedValue(updated),
        },
        adminAuditLogEntry: { create: jest.fn() },
      } as unknown as PrismaService,
      { emitAccountSuspended },
      mail,
    );

    await service.suspendUser('admin-1', 'user-1', {
      reason: 'SPAM',
      durationDays: null,
      note: 'Repeated spam',
    });

    expect(emitAccountSuspended).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ suspendedUntil: null }),
    );
    expect(mail.sendAccountSuspendedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        name: 'User',
        suspendedUntil: undefined,
      }),
    );
  });

  it('emails an admin a real reset link after persisting a hashed token', async () => {
    const mail = mailMock();
    const update = jest.fn().mockResolvedValue({});
    const service = createService(
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'admin-2',
            email: 'admin@example.com',
            role: 'ADMIN',
          }),
          update,
        },
        adminAuditLogEntry: { create: jest.fn() },
      } as unknown as PrismaService,
      {},
      mail,
    );

    await expect(
      service.resetAdminPassword('admin-1', 'admin-2'),
    ).resolves.toEqual({ sent: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'admin-2' },
      data: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        resetToken: expect.stringMatching(/^[a-f0-9]{64}$/),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        resetTokenExpiry: expect.any(Date),
      },
    });
    expect(mail.sendPasswordResetEmail).toHaveBeenCalledWith(
      'admin@example.com',
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });
});
