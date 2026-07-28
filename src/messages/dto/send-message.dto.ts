import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  // Optional when an attachment is present; the service rejects fully-empty sends.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  attachmentUrl?: string;

  @IsOptional()
  @IsIn(['IMAGE', 'VIDEO', 'AUDIO'])
  attachmentType?: 'IMAGE' | 'VIDEO' | 'AUDIO';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  attachmentName?: string;

  @IsOptional()
  @IsInt()
  attachmentDurationMs?: number;
}
