import { LeaseContractStatus } from 'generated/prisma/client';

/**
 * Wire format is lowercase, matching the frontend's requested
 * `draftStatus: 'drafting' | 'reviewing' | 'generated'` — DB stays
 * upper-snake for consistency with every other enum in this schema (see
 * ticket-status.mapper.ts in the customer-support module for the same
 * pattern).
 */
export const WIRE_LEASE_CONTRACT_STATUSES = [
  'drafting',
  'reviewing',
  'generated',
] as const;

export type WireLeaseContractStatus =
  (typeof WIRE_LEASE_CONTRACT_STATUSES)[number];

const TO_WIRE: Record<LeaseContractStatus, WireLeaseContractStatus> = {
  DRAFTING: 'drafting',
  PENDING_TENANT_APPROVAL: 'reviewing',
  APPROVED: 'generated',
};

export function leaseContractStatusToWire(
  status: LeaseContractStatus,
): WireLeaseContractStatus {
  return TO_WIRE[status];
}
