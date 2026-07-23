import { IsBoolean, IsOptional, MinLength } from 'class-validator';

export class ReplyTicketDto {
  @MinLength(1, { message: 'content_required' })
  content!: string;

  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}
