import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ReplyTicketDto } from './dto/reply-ticket.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { SupportService } from './support.service';

/**
 * Matches the frontend's existing (previously unbacked) contract exactly:
 * src/lib/api/hooks/useTickets.ts + src/mocks/router.ts's admin/tickets
 * handlers. Same guard convention as every other admin route (admin.controller.ts).
 */
@Controller('admin/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminTicketsController {
  constructor(private readonly supportService: SupportService) {}

  @Get()
  async list() {
    return this.supportService.listTickets();
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.supportService.getTicket(id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/reply')
  async reply(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: ReplyTicketDto,
  ) {
    return this.supportService.reply(req.user.userId, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/assign')
  async assign(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.supportService.assign(req.user.userId, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/status')
  async setStatus(@Param('id') id: string, @Body() dto: UpdateTicketStatusDto) {
    return this.supportService.setStatus(id, dto.status);
  }
}
