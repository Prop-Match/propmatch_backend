import { IdentityVerification, User } from 'generated/prisma/client';

export interface TransformedUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: 'user' | 'admin';
  verificationStatus: 'unverified' | 'pending_review' | 'verified' | 'rejected';
  verificationRejectedAt: string | null;
  verificationResubmitAfter: string | null;
  verificationRejectionReason: string | null;
  createdAt: string;
}

export function transformUserToFrontend(
  user: User & { identityVerification?: IdentityVerification | null },
): TransformedUser {
  let verificationStatus:
    'unverified' | 'pending_review' | 'verified' | 'rejected' = 'unverified';

  const dbStatus = user.identityVerification?.status;
  if (dbStatus === 'PENDING') {
    verificationStatus = 'pending_review';
  } else if (dbStatus === 'APPROVED') {
    verificationStatus = 'verified';
  } else if (dbStatus === 'REJECTED') {
    verificationStatus = 'rejected';
  }

  const mappedRole: 'user' | 'admin' =
    user.role === 'ADMIN' || user.role === 'SUPERADMIN' ? 'admin' : 'user';

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phoneNumber, // Map phoneNumber -> phone
    role: mappedRole,
    verificationStatus,
    verificationRejectedAt:
      user.identityVerification?.reviewedAt &&
      user.identityVerification.status === 'REJECTED'
        ? new Date(user.identityVerification.reviewedAt).toISOString()
        : null,
    verificationResubmitAfter: null,
    verificationRejectionReason:
      user.identityVerification?.rejectionReason || null,
    createdAt: new Date(user.createdAt).toISOString(),
  };
}
