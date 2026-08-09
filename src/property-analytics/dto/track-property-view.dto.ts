import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class TrackPropertyViewDto {
  /** Random first-party browser identifier; never send an email, phone, or IP. */
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(200)
  visitorId?: string;
}
