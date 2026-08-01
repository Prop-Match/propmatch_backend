import { PropertyType } from '@generated/prisma/enums';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

function multipartBoolean({ value }: TransformFnParams): unknown {
  const candidate: unknown = value;
  return candidate === 'true'
    ? true
    : candidate === 'false'
      ? false
      : candidate;
}

/** Landlord-authored fields shared by create and full-edit submissions. */
export class PropertyFieldsDto {
  @IsString()
  @MinLength(4)
  title: string;

  @IsString()
  @MinLength(20)
  description: string;

  @IsString()
  @IsNotEmpty()
  governorate: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  district: string;

  @IsString()
  @MinLength(5)
  manualAddress: string;

  @IsEnum(PropertyType)
  propertyType: PropertyType;

  @IsString()
  @IsNotEmpty()
  propertyAroundServices: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  rentAmount: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  areaM2: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  bedrooms: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  bathrooms: number;

  @Transform(multipartBoolean)
  @IsBoolean()
  isFurnished: boolean;

  @Transform(multipartBoolean)
  @IsBoolean()
  hasElevator: boolean;

  @Transform(multipartBoolean)
  @IsBoolean()
  hasParking: boolean;
}
