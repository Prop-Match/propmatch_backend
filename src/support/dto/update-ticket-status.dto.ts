import { IsIn } from 'class-validator';
import { WIRE_TICKET_STATUSES } from '../ticket-status.mapper';
import type { WireTicketStatus } from '../ticket-status.mapper';

export class UpdateTicketStatusDto {
  @IsIn(WIRE_TICKET_STATUSES)
  status!: WireTicketStatus;
}
