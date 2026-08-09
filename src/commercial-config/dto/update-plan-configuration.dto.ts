import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UpdatePlanConfigurationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  activeListings!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  offers!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  aiUses!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  boostCredits!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  boostDurationDays!: number;
}
