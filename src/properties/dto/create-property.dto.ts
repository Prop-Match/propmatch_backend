import { PropertyType } from "@generated/prisma/enums";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsString, ValidateNested } from "class-validator";
import { PropertyConditionsDto } from "./property-conditions.dto";
import { PropertyLocationDto } from "./property-location.dto";

export class CreatePropertyDto {
    @IsString()
    @IsNotEmpty()
    title: string;

    @IsString()
    @IsNotEmpty()
    description: string;

    @ValidateNested()
    @Type(() => PropertyLocationDto)
    location: PropertyLocationDto;

    @IsEnum(PropertyType)
    propertyType: PropertyType;

    // @IsString()
    // @IsNotEmpty()
    // propertyAroundServices: string;

    @IsNumber()
    @IsNotEmpty()
    monthlyRent: number;

    @IsNumber()
    @IsNotEmpty()
    deposit: number;

    @IsNumber()
    @IsNotEmpty()
    leaseDurationMonths: number;

    @IsNumber()
    @IsNotEmpty()
    area: number;

    @IsNumber()
    @IsNotEmpty()
    rooms: number;

    @IsNumber()
    @IsNotEmpty()
    bathrooms: number;

    @IsString()
    @IsNotEmpty()
    finish: string;

    @IsBoolean()
    @IsNotEmpty()
    isFurnished: boolean;

    @IsString()
    @IsNotEmpty()
    orientation: string;

    @IsArray()
    @IsString({ each: true })
    amenities: string[];

    @IsBoolean()
    @IsNotEmpty()
    hasElevator: boolean;

    @IsBoolean()
    @IsNotEmpty()
    hasParking: boolean;

    @ValidateNested()
    @Type(() => PropertyConditionsDto)
    conditions: PropertyConditionsDto;

}