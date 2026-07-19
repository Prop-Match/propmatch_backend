import { IdentityVerification, User } from 'generated/prisma/client';

/**
 * Matches the frontend's `UserSchema` (propmatch_frontend/src/lib/api/contracts/auth.ts)
 * exactly — field names and the verificationStatus enum must stay in sync
 * with that contract.
 */
export interface TransformedUser {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  role: 'tenant' | 'landlord' | 'admin';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  verificationStatus:
    | 'NOT_SUBMITTED'
    | 'PENDING'
    | 'APPROVED'
    | 'REJECTED'
    | 'RESUBMISSION_REQUIRED';
}

export function transformUserToFrontend(
  user: User & { identityVerification?: IdentityVerification | null },
): TransformedUser {
  const dbStatus = user.identityVerification?.status;
  const verificationStatus: TransformedUser['verificationStatus'] =
    dbStatus ?? 'NOT_SUBMITTED';

  const mappedRole: 'tenant' | 'landlord' | 'admin' =
    user.role === 'ADMIN'
      ? 'admin'
      : user.role === 'LANDLORD'
        ? 'landlord'
        : 'tenant';

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phoneNumber: user.phoneNumber,
    role: mappedRole,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt
      ? new Date(user.lastLoginAt).toISOString()
      : null,
    createdAt: new Date(user.createdAt).toISOString(),
    updatedAt: new Date(user.updatedAt).toISOString(),
    verificationStatus,
  };
}
