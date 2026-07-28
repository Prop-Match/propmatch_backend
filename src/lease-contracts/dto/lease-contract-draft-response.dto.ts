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
  disclaimer!: ContractDraftDisclaimerDto;
}

export class ContractDraftDisclaimerDto {
  isDraft!: boolean;
  isElectronicSignature!: false;
  isLegallyAuthenticated!: false;
  message!: string;
}
