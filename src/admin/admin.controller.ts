import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  Patch,
  Post,
  Req,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminService } from './admin.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ReviewDecisionDto } from './dto/review-decision.dto';

interface RequestWithUser {
  user?: { userId: string };
}

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest(err: any, user: any): any {
    return user || null;
  }
}

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('session')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getSession(@Request() req: { user: { userId: string } }) {
    return this.adminService.getSession(req.user.userId);
  }

  @Get('queues')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getQueues() {
    return this.adminService.getQueues();
  }

  @Get('kyc/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getKyc(@Param('id') id: string) {
    return await this.adminService.getKyc(id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('kyc/:userId/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async reviewKyc(
    @Request() req: { user: { userId: string } },
    @Param('userId') userId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminService.reviewKyc(req.user.userId, userId, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/:propertyId/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async reviewProperty(
    @Request() req: { user: { userId: string } },
    @Param('propertyId') propertyId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminService.reviewProperty(req.user.userId, propertyId, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('requests/:requestId/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async reviewRequest(
    @Request() req: { user: { userId: string } },
    @Param('requestId') requestId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminService.reviewRequest(req.user.userId, requestId, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('reviews/:reviewId/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async reviewUserReview(
    @Request() req: { user: { userId: string } },
    @Param('reviewId') reviewId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminService.reviewUserReview(req.user.userId, dto, reviewId);
  }

  @Post('register')
  @UseGuards(OptionalJwtAuthGuard)
  async registerAdmin(
    @Req() req: RequestWithUser,
    @Body() dto: CreateAdminDto,
  ) {
    return this.adminService.createAdmin(req.user?.userId, dto);
  }

  @Get('team')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getTeam() {
    return this.adminService.getTeam();
  }

  @Patch('team/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async updateTeamMember(
    @Param('id') id: string,
    @Body() dto: { role?: string; disabled?: boolean },
  ) {
    return this.adminService.updateTeamMember(id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('team/:id/reset-password')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async resetPassword(@Param('id') id: string) {
    //Todo: create reset password implementation
    return { sent: true };
  }
}
