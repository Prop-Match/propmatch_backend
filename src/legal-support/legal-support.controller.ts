import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LegalChatDto } from './dto/legal-chat.dto';
import { LegalSupportService, LegalSupportUser } from './legal-support.service';

interface AuthenticatedRequest {
  user: LegalSupportUser;
}

@Controller('legal-chat')
@UseGuards(JwtAuthGuard)
export class LegalSupportController {
  constructor(private readonly legalSupport: LegalSupportService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  chat(@Request() request: AuthenticatedRequest, @Body() dto: LegalChatDto) {
    return this.legalSupport.chat(dto.message, request.user);
  }

  @Post('stream')
  @HttpCode(HttpStatus.OK)
  async stream(
    @Request() request: AuthenticatedRequest,
    @Body() dto: LegalChatDto,
    @Res() response: ExpressResponse,
  ): Promise<void> {
    const abortController = new AbortController();
    response.once('close', () => abortController.abort());

    const upstream = await this.legalSupport.openStream(
      dto.message,
      request.user,
      abortController.signal,
    );
    response.status(upstream.status);
    response.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') ??
        'text/event-stream; charset=utf-8',
    );
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const reader = upstream.body!.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        response.write(Buffer.from(value));
      }
      response.end();
    } catch (error) {
      if (!abortController.signal.aborted) response.destroy(error as Error);
    } finally {
      reader.releaseLock();
    }
  }
}
