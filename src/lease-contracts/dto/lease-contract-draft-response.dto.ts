import type { WireLeaseContractStatus } from '../lease-contract-status.mapper';

/** Safe client view; it deliberately excludes KYC, PDF, signature, and raw relation fields. */
export class LeaseContractDraftResponseDto {
  id!: string;
  matchConnectionId!: string;
  status!: WireLeaseContractStatus;
  ownerName!: string;
  tenantName!: string;
  propertyAddress!: string;
  customClauses!: string[];
  rentAmount!: number;
  startDate!: string;
  endDate!: string;
  createdAt!: string;
  updatedAt?: string;
  disclaimer!: ContractDraftDisclaimerDto;
  tenantReviewStatus?: string;
  tenantChangeRequest?: string | null;
  tenantChangeRequestedAt?: string | null;
  tenantReviewConfirmedAt?: string | null;
  draftRevision?: number;
  tenantReviewedRevision?: number | null;
  canEdit?: boolean;
  canRequestChanges?: boolean;
  canConfirmReview?: boolean;
  canDownloadPdf?: boolean;
}

export class ContractDraftDisclaimerDto {
  isDraft!: boolean;
  isElectronicSignature!: false;
  isLegallyAuthenticated!: false;
  message!: string;
}
