import { TicketStatus } from './../../generated/prisma/enums';

/**
 * The frontend's TicketStatusSchema (src/lib/api/contracts/support.ts) uses
 * lowercase snake_case values ("in_progress"), while the Prisma enum here is
 * upper-snake ("IN_PROGRESS") like every other enum in this schema. This is
 * the single translation point so the wire format matches what the already
 * -built AdminTickets/AdminTicketDetail UI expects (status labels + the
 * status <select>'s value binding both key off the lowercase form).
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
  new: TicketStatus.NEW,
  assigned: TicketStatus.ASSIGNED,
  in_progress: TicketStatus.IN_PROGRESS,
  waiting: TicketStatus.WAITING,
  closed: TicketStatus.CLOSED,
};

export function ticketStatusToWire(status: TicketStatus): WireTicketStatus {
  return TO_WIRE[status];
}

export function ticketStatusToDb(status: WireTicketStatus): TicketStatus {
  return TO_DB[status];
}
