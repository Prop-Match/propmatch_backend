import { VerificationStatus } from 'generated/prisma/client';
import {
  VerificationResponseDto,
  type VerificationResponseStatus,
} from '../dto/verification-response.dto';

export type SafeVerificationSelection = {
  status: VerificationStatus;
  rejectionReason: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
};

export function toVerificationResponse(
  verification: SafeVerificationSelection | null,
): VerificationResponseDto {
  if (!verification) {
    return {
      status: 'NOT_SUBMITTED',
      rejectionReason: null,
      submittedAt: null,
      reviewedAt: null,
      canSubmit: true,
    };
  }

  const status = verification.status as VerificationResponseStatus;
  const canSubmit = status === 'RESUBMISSION_REQUIRED';
  const showRejectionReason =
    status === 'REJECTED' || status === 'RESUBMISSION_REQUIRED';

  return {
    status,
    rejectionReason: showRejectionReason ? verification.rejectionReason : null,
    submittedAt: verification.submittedAt,
    reviewedAt: verification.reviewedAt,
    canSubmit,
  };
}
