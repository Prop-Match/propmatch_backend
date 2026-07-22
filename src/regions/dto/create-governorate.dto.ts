import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateGovernorateDto {
  @IsNotEmpty()
  @IsString()
  nameAr!: string;

  @IsNotEmpty()
  @IsString()
  nameEn!: string;

  @IsNotEmpty()
  @IsNumber()
  countryId!: number;
}
