import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCountryDto {
  @IsNotEmpty()
  @IsString()
  nameAr!: string;

  @IsNotEmpty()
  @IsString()
  nameEn!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  code!: string;

  @IsOptional()
  @IsString()
  image?: string;
}
