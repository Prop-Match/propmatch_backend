import { TicketStatus } from 'generated/prisma/client';

/**
 * The frontend's TicketStatusSchema (src/lib/api/contracts/support.ts) uses
 * lowercase snake_case values, while every other enum in this schema is
 * upper-snake on the wire (see PropertyStatus, VerificationStatus, ...).
 * Since this ticket contract predates the backend and was never ratified
 * (see ASSUMPTIONS.md #26 on the frontend), Prisma keeps the repo's usual
 * upper-snake convention and this module is the single translation point.
 */
export const WIRE_TICKET_STATUSES = [
  'new',
  'assigned',
  'in_progress',
  'waiting',
  'closed',
] as const;

export type WireTicketStatus = (typeof WIRE_TICKET_STATUSES)[number];

const TO_WIRE: Record<TicketStatus, WireTicketStatus> = {
  NEW: 'new',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  WAITING: 'waiting',
  CLOSED: 'closed',
};

const TO_DB: Record<WireTicketStatus, TicketStatus> = {
  new: 'NEW',
  assigned: 'ASSIGNED',
  in_progress: 'IN_PROGRESS',
  waiting: 'WAITING',
  closed: 'CLOSED',
};

export function ticketStatusToWire(status: TicketStatus): WireTicketStatus {
  return TO_WIRE[status];
}

export function ticketStatusToDb(status: WireTicketStatus): TicketStatus {
  return TO_DB[status];
}
