import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CreateHandoffDto } from './dto/create-handoff.dto';
import { InternalServiceGuard } from './guards/internal-service.guard';
import { SupportService } from './support.service';

/**
 * The inbound half of the legal-support integration: the external RAG
 * service calls this when its `transfer_to_human_support(user_id,
 * chat_summary)` tool fires (off-topic-after-retry, or an explicit user
 * request for a human). Mirrors the outbound call shape in
 * legal-support.service.ts, just in the opposite direction — same shared
 * key, checked by InternalServiceGuard instead of sent by us.
 *
 * Not built yet on the AI service's side (blocked on the same missing
 * embedding model that empties the Chroma collection) — this endpoint is
 * ready for when it is.
 */
@Controller('support/handoff')
@UseGuards(InternalServiceGuard)
export class HandoffController {
  constructor(private readonly supportService: SupportService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async handoff(@Body() dto: CreateHandoffDto) {
    return this.supportService.createFromHandoff(dto);
  }
}
