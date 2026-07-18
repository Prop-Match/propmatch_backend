import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class PropertyLocationDto {
    @IsString()
    @IsNotEmpty()
    governorate: string;

    @IsString()
    @IsNotEmpty()
    city: string;

    @IsString()
    @IsNotEmpty()
    neighborhood: string;

    @IsString()
    @IsNotEmpty()
    detailedAddress: string;

    @IsString()
    @IsOptional()
    street?: string;
    
}