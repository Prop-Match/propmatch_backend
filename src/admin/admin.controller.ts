import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminService } from './admin.service';
import { ReviewDecisionDto } from './dto/review-decision.dto';

type AuthedRequest = { user: { userId: string; email: string; role: string } };

/**
 * Pending-entity moderation queues (properties, eKYC, tenant requests,
 * reviews) for the admin dashboard. Scoped to Week 1 — team/audit/stats
 * surfaces are out of scope until an admin sub-role model exists.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('session')
  getSession(@Request() req: AuthedRequest) {
    return this.adminService.getSession(req.user.userId);
  }

  @Get('queues')
  getQueues() {
    return this.adminService.getQueues();
  }

  @Get('kyc/:userId')
  getKycDetail(@Param('userId') userId: string) {
    return this.adminService.getKycDetail(userId);
  }

  @Post('kyc/:userId/review')
  reviewKyc(
    @Param('userId') userId: string,
    @Request() req: AuthedRequest,
    @Body() decision: ReviewDecisionDto,
  ) {
    return this.adminService.reviewKyc(userId, req.user.userId, decision);
  }

  @Post('properties/:id/review')
  reviewProperty(
    @Param('id') id: string,
    @Request() req: AuthedRequest,
    @Body() decision: ReviewDecisionDto,
  ) {
    return this.adminService.reviewProperty(id, req.user.userId, decision);
  }

  @Get('requests/:id')
  getRequestDetail(@Param('id') id: string) {
    return this.adminService.getRequestDetail(id);
  }

  @Post('requests/:id/review')
  reviewRequest(
    @Param('id') id: string,
    @Request() req: AuthedRequest,
    @Body() decision: ReviewDecisionDto,
  ) {
    return this.adminService.reviewRequest(id, req.user.userId, decision);
  }

  @Get('reviews/:id')
  getReviewDetail(@Param('id') id: string) {
    return this.adminService.getReviewDetail(id);
  }

  @Post('reviews/:id/review')
  reviewReview(
    @Param('id') id: string,
    @Request() req: AuthedRequest,
    @Body() decision: ReviewDecisionDto,
  ) {
    return this.adminService.reviewReview(id, req.user.userId, decision);
  }
}
