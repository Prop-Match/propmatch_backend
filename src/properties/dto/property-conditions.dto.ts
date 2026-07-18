import { IsBoolean } from "class-validator";

export class PropertyConditionsDto {
    @IsBoolean()
    familiesOnly: boolean;

    @IsBoolean()
    studentsAllowed: boolean;

    @IsBoolean()
    singlesAllowed: boolean;

    @IsBoolean()
    foreignersAllowed: boolean;

    @IsBoolean()
    childrenAllowed: boolean;

    @IsBoolean()
    petsAllowed: boolean;

    @IsBoolean()
    smokingAllowed: boolean;
}

