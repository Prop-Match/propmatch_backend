import { IsIn } from 'class-validator';
import { WIRE_TICKET_STATUSES } from '../ticket-status.mapper';
import type { WireTicketStatus } from '../ticket-status.mapper';

export class UpdateStatusDto {
  @IsIn(WIRE_TICKET_STATUSES)
  status!: WireTicketStatus;
}
