import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class LegalAttachmentDto {
  @IsString()
  @MaxLength(512)
  url!: string;

  @IsIn(['IMAGE', 'VIDEO', 'AUDIO'])
  type!: 'IMAGE' | 'VIDEO' | 'AUDIO';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class LegalChatDto {
  // Optional when an attachment is present; the legal service enforces
  // "message or attachment required".
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LegalAttachmentDto)
  attachments?: LegalAttachmentDto[];
}
