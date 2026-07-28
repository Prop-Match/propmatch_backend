import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CustomerSupportService } from './customer-support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { PostReplyDto } from './dto/post-reply.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

import { ConfigService } from '@nestjs/config';
import type { Response as ExpressResponse } from 'express';
interface RequestWithUser {
  user?: { userId: string; role?: string };
}
@UseGuards(JwtAuthGuard)
@Controller()
export class CustomerSupportController {
  constructor(
    private readonly customerSupportService: CustomerSupportService,
    private readonly config: ConfigService,
  ) {}

  @Post('support/tickets')
  async createTicket(
    @Request() req: RequestWithUser,
    @Body() dto: CreateTicketDto,
  ) {
    return this.customerSupportService.createTicket(req.user!.userId, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('support/ai-chat/stream')
  async streamAiChat(
    @Request() req: RequestWithUser,
    @Body() dto: { message: string; history?: any[] },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const abortController = new AbortController();
    res.once('close', () => abortController.abort());

    const upstream = await this.customerSupportService.openAiStream(
      dto.message,
      dto.history,
      req.user!,
      abortController.signal,
    );

    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') ??
        'text/event-stream; charset=utf-8',
    );
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const reader = upstream.body!.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (error) {
      if (!abortController.signal.aborted) res.destroy(error as Error);
    } finally {
      reader.releaseLock();
    }
  }

  @Get('support/my-tickets')
  async getMyTickets(@Request() req: RequestWithUser) {
    return this.customerSupportService.getUserTickets(req.user!.userId);
  }
  @Get('support/tickets/:id')
  async getTicketDetail(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ) {
    return this.customerSupportService.getTicketDetail(id, req.user!.userId);
  }
  @HttpCode(HttpStatus.OK)
  @Post('support/tickets/:id/reply')
  async userReply(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: PostReplyDto,
  ) {
    return this.customerSupportService.addUserReply(id, req.user!.userId, dto);
  }
  // --- Admin Endpoints ---
  @Get('admin/tickets')
  @Roles('ADMIN')
  async getAdminQueue() {
    return this.customerSupportService.getAdminTickets();
  }
  @HttpCode(HttpStatus.OK)
  @Post('admin/tickets/:id/reply')
  @Roles('ADMIN')
  async adminReply(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: PostReplyDto,
  ) {
    return this.customerSupportService.addAdminReply(id, req.user!.userId, dto);
  }
  @HttpCode(HttpStatus.OK)
  @Post('admin/tickets/:id/assign')
  @Roles('ADMIN')
  async assignTicket(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.customerSupportService.assignToAdmin(id, req.user!.userId);
  }
  @HttpCode(HttpStatus.OK)
  @Post('admin/tickets/:id/status')
  @Roles('ADMIN')
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.customerSupportService.updateStatus(id, dto.status);
  }

  @Get('admin/tickets/:id')
  @Roles('ADMIN')
  async getAdminTicketDetail(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ) {
    return this.customerSupportService.getTicketDetail(id, req.user!.userId);
  }
}
