import { IsEnum, IsNotEmpty } from 'class-validator';
import { TicketStatus } from './../../../generated/prisma/enums';
export class UpdateStatusDto {
  @IsEnum(TicketStatus)
  @IsNotEmpty()
  ticketStatus!: TicketStatus;
}
