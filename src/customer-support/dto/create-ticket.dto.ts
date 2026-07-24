import { SupportPriority } from '@generated/prisma/enums';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @IsString()
  @IsNotEmpty()
  initialMessage!: string;

  @IsEnum(SupportPriority)
  @IsOptional()
  priority?: SupportPriority;

  @IsString()
  @IsOptional()
  escalationReason?: string;
}
