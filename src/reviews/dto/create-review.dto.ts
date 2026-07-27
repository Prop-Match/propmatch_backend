import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Matches the frontend's CreateReviewRequestSchema (contracts/review.ts). */
export class CreateReviewDto {
  @IsString()
  propertyId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  comment: string;
}
