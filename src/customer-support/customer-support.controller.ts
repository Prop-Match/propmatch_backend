import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CustomerSupportService } from './customer-support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { PostReplyDto } from './dto/post-reply.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

interface RequestWithUser {
  user?: { userId: string };
}
@UseGuards(JwtAuthGuard)
@Controller()
export class CustomerSupportController {
  constructor(
    private readonly customerSupportService: CustomerSupportService,
  ) {}

  @Post('support/tickets')
  async createTicket(
    @Request() req: RequestWithUser,
    @Body() dto: CreateTicketDto,
  ) {
    return this.customerSupportService.createTicket(req.user!.userId, dto);
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
    return this.customerSupportService.addUserReply(
      id,
      req.user!.userId,
      dto.content,
    );
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
  @Patch('admin/tickets/:id/status')
  @Roles('ADMIN')
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.customerSupportService.updateStatus(id, dto.ticketStatus);
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
