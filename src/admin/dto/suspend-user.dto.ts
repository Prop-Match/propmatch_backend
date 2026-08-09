import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  SUSPENSION_DURATION_DAYS,
  SUSPENSION_REASON_CODES,
  type SuspensionReasonCode,
} from '../../common/suspension';

export class SuspendUserDto {
  @IsIn(SUSPENSION_REASON_CODES)
  reason!: SuspensionReasonCode;

  // Omitted / null ⇒ permanent. Otherwise one of the allowed presets (days).
  @IsOptional()
  @IsIn(SUSPENSION_DURATION_DAYS)
  durationDays?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
