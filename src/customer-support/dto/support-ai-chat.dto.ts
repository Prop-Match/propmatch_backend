import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SupportAiChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;

  @IsArray()
  @IsOptional()
  history?: Array<{ role: string; content: string }>;

  @IsUUID()
  @IsOptional()
  clientRequestId?: string;
}
