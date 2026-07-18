import { PropertyType } from '@generated/prisma/enums';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Matches the frontend CreateTenantRequestSchema
 * (src/lib/api/contracts/tenantRequest.ts).
 */
export class CreateTenantRequestDto {
  @IsNumber()
  @Min(0)
  minBudget: number;

  @IsNumber()
  @Min(1)
  maxBudget: number;

  @IsString()
  @MinLength(2)
  preferredLocations: string;

  @IsEnum(PropertyType)
  propertyType: PropertyType;

  @IsInt()
  @Min(0)
  requiredBedrooms: number;

  @IsBoolean()
  needsFurnished: boolean;

  @IsInt()
  @Min(1)
  @Max(10)
  flexibilityScore: number;

  @IsString()
  @MinLength(10)
  lifestyleRequirements: string;
}
