import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateUserReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  overallRating!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  communicationRating!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  responsivenessRating!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  propertyAccuracyRating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  commitmentRating?: number;
}
