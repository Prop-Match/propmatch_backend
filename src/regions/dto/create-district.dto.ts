import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class CreateDistrictDto {
  @IsInt()
  cityId!: number;

  @IsNotEmpty()
  @IsString()
  nameAr!: string;

  @IsNotEmpty()
  @IsString()
  nameEn!: string;
}
