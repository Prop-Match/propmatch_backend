import {
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Matches the frontend's CreateOfferRequestSchema
 * (src/lib/api/contracts/offer.ts).
 */
export class CreateOfferDto {
  @IsString()
  tenantRequestId: string;

  @IsString()
  propertyId: string;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  pitchMessage: string;

  @IsNumber()
  @IsPositive()
  proposedPrice: number;
}
