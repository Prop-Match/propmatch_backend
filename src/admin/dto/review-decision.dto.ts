import { IsEnum, IsOptional, MinLength } from 'class-validator';

export class ReviewDecisionDto {
  @IsEnum(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @IsOptional()
  @MinLength(3, { message: 'reason_too_short' })
  reason?: string;
}
