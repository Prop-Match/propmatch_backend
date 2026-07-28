import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Tenant-only. */
export class RejectDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
