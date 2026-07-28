import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { TicketStatus } from './../../../generated/prisma/enums';

/**
 * Body for POST /admin/tickets/:id/status. The frontend + mock contract send
 * `{ status }` (not `{ ticketStatus }`) and use lowercase values
 * (e.g. "in_progress"), while the Prisma enum is uppercase — so normalize the
 * casing before validating against the enum.
 */
export class PostTicketStatusDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(TicketStatus)
  @IsNotEmpty()
  status!: TicketStatus;
}
