import { SupportPriority } from '@generated/prisma/enums';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Trusted payload sent only by the support-agent service after it selects the
 * create-support-ticket tool. User identity is carried in authenticated
 * headers, never in this payload. */
export class CreateAgentEscalationDto {
  @IsUUID()
  agentRunId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;

  @IsEnum(SupportPriority)
  priority!: SupportPriority;
}
