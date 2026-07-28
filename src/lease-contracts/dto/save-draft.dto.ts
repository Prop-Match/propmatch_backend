import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Landlord-only. Owner/tenant names, national IDs, and property address
 * are never accepted from the client — they're derived server-side.
 * customClauses is one entry per Hybrid Contract Builder block; empty ones
 * are filtered client-side and again here before persisting.
 */
export class SaveDraftDto {
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  rentAmount?: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  startDate!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  endDate!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(2000, { each: true })
  customClauses?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  witness1Name?: string;

  @IsOptional()
  @Matches(/^\d{14}$/, { message: 'الرقم القومي 14 رقمًا' })
  witness1NationalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  witness2Name?: string;

  @IsOptional()
  @Matches(/^\d{14}$/, { message: 'الرقم القومي 14 رقمًا' })
  witness2NationalId?: string;
}
