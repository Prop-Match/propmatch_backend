import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class PostReplyDto {
  // Optional when an attachment is present; the service rejects fully-empty replies.
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsBoolean()
  internal?: boolean;

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
