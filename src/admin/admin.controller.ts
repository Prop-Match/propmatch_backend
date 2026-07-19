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

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}
  @Get('session')
  async getSession(@Request() req: { user: { userId: string } }) {
    return this.adminService.getSession(req.user.userId);
  }

  @Get('queues')
  async getQueues() {
    return this.adminService.getQueues();
  }
  @Get('kyc/:id')
  async getKyc(@Param('id') id: string) {
    return await this.adminService.getKyc(id);
  }

  @Post('kyc/:userId/review')
  async reviewKyc(
    @Request() req: { user: { userId: string } },
    @Param('userId') userId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminService.reviewKyc(req.user.userId, userId, dto);
  }

  @Post('properties/:propertyId/review')
  async reviewProperty(
    @Request() req: { user: { userId: string } },
    @Param('propertyId') propertyId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminService.reviewProperty(req.user.userId, propertyId, dto);
  }

  @Post('requests/:requestId/review')
  async reviewRequest(
    @Request() req: { user: { userId: string } },
    @Param('requestId') requestId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminService.reviewRequest(req.user.userId, requestId, dto);
  }

  @Post('reviews/:reviewId/review')
  async reviewUserReview(
    @Request() req: { user: { userId: string } },
    @Param('reviewId') reviewId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminService.reviewUserReview(req.user.userId, dto, reviewId);
  }
}
