import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class RequestContractChangesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message!: string;
}

export class ConfirmContractReviewDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}
