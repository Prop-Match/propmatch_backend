export type VerificationResponseStatus =
  | 'NOT_SUBMITTED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESUBMISSION_REQUIRED';

export class VerificationResponseDto {
  status!: VerificationResponseStatus;
  rejectionReason!: string | null;
  submittedAt!: Date | null;
  reviewedAt!: Date | null;
  canSubmit!: boolean;
}
