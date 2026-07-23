import { IsOptional, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Body the external legal-support AI service sends when it invokes its
 * `transfer_to_human_support(user_id, chat_summary)` tool. Field names use
 * the tool's own snake_case (mirrors the request/response convention already
 * used for the outbound `X-PropMatch-User-Id` headers in legal-support.service.ts).
 */
export class CreateHandoffDto {
  @IsUUID()
  user_id!: string;

  @MinLength(1, { message: 'chat_summary_required' })
  @MaxLength(4000)
  chat_summary!: string;

  @IsOptional()
  @MaxLength(200)
  subject?: string;
}
