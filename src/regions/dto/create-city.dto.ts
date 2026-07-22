import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateCityDto {
  @IsNumber()
  governorateId!: number;
  @IsString()
  @IsNotEmpty()
  nameAr!: string;
  @IsString()
  @IsNotEmpty()
  nameEn!: string;
}
