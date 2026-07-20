import { IsNumber, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Matches the frontend `CreateOfferRequestSchema` (offer.ts).
 * A landlord picks one of their APPROVED properties and pitches it against an
 * approved tenant request.
 */
export class CreateOfferDto {
  @IsString()
  tenantRequestId: string;

  /** ERD allows null (quick-add); V1 always selects an existing property. */
  @IsString()
  propertyId: string;

  @IsString()
  @MinLength(10, { message: 'اكتب رسالة لا تقل عن ١٠ أحرف' })
  @MaxLength(1000)
  pitchMessage: string;

  @IsNumber()
  @IsPositive()
  proposedPrice: number;
}
