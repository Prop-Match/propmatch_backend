import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTenantOfferDto {
  @IsUUID()
  propertyId!: string;

  @IsNumber()
  @IsPositive()
  proposedPrice!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message!: string;
}

export class CounterOfferDto {
  @IsNumber()
  @IsPositive()
  counterPrice!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  counterMessage?: string;
}
