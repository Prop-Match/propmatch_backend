import { PropertyType } from '@generated/prisma/enums';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ArrayMinSize,
} from 'class-validator';

export class CreatePropertyDto {
  @IsString()
  @MinLength(4)
  title: string;

  @IsString()
  @MinLength(20)
  description: string;

  // ── Location (flat, matching frontend) ──────────────────────────────

  @IsString()
  @IsNotEmpty()
  governorate: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  /** Frontend sends "district" → maps to Prisma "neighborhood" */
  @IsString()
  @IsNotEmpty()
  district: string;

  /** Frontend sends "manualAddress" → maps to Prisma "detailedAddress" (manual_address) */
  @IsString()
  @MinLength(5)
  manualAddress: string;

  // ── Property type ───────────────────────────────────────────────────

  @IsEnum(PropertyType)
  propertyType: PropertyType;

  /** Free text fed to the AI matcher — optional */
  @IsString()
  @IsOptional()
  propertyAroundServices?: string;

  // ── Financials & dimensions ─────────────────────────────────────────

  /** Frontend sends "rentAmount" → maps to Prisma "monthlyRent" */
  @IsNumber()
  @Min(1)
  rentAmount: number;

  /** Frontend sends "areaM2" → maps to Prisma "area" */
  @IsNumber()
  @Min(1)
  areaM2: number;

  /** Frontend sends "bedrooms" → maps to Prisma "rooms" */
  @IsNumber()
  @Min(0)
  bedrooms: number;

  @IsNumber()
  @Min(0)
  bathrooms: number;

  // ── Booleans ────────────────────────────────────────────────────────

  @IsBoolean()
  isFurnished: boolean;

  @IsBoolean()
  hasElevator: boolean;

  @IsBoolean()
  hasParking: boolean;

  // ── Images ──────────────────────────────────────────────────────────

  /** Array of image URLs — at least 1 required */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  images: string[];
}