import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminService } from './admin.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ReviewDecisionDto } from './dto/review-decision.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { CapabilitiesGuard } from './guards/capabilities.guard';
import { RequireCapability } from './decorators/require-capability.decorator';

interface RequestWithUser {
  user?: { userId: string };
}

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest(err: any, user: any): any {
    return user || null;
  }
}

// Every admin route requires the ADMIN role. Routes that MUTATE state or expose
// sensitive data additionally require a specific capability (CapabilitiesGuard +
// @RequireCapability), so an admin sub-role (e.g. customer-support, read-only)
// can no longer perform actions outside its remit. Plain dashboard views carry
// no capability requirement and remain visible to every admin, including
// read-only.
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly configService: ConfigService,
  ) {}

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
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('kyc:review')
  async getKyc(@Param('id') id: string) {
    const kyc = await this.adminService.getKyc(id);
    const origin = this.publicBackendOrigin();
    return {
      ...kyc,
      nationalIdFrontUrl: new URL(kyc.nationalIdFrontUrl, origin).toString(),
      nationalIdBackUrl: new URL(kyc.nationalIdBackUrl, origin).toString(),
      selfieUrl: new URL(kyc.selfieUrl, origin).toString(),
    };
  }

  private publicBackendOrigin(): string {
    const value = this.configService.get<string>('BACKEND_PUBLIC_URL')?.trim();
    if (!value) return 'http://localhost:3001';
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('BACKEND_PUBLIC_URL must use http or https');
    }
    return url.toString().replace(/\/$/, '');
  }

  @HttpCode(HttpStatus.OK)
  @Post('kyc/:userId/review')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('kyc:review')
  async reviewKyc(
    @Request() req: { user: { userId: string } },
    @Param('userId') userId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminService.reviewKyc(req.user.userId, userId, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/:propertyId/review')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('property:approve', 'property:reject')
  async reviewProperty(
    @Request() req: { user: { userId: string } },
    @Param('propertyId') propertyId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminService.reviewProperty(req.user.userId, propertyId, dto);
  }

  // --- Account suspension (violation enforcement) ---
  @HttpCode(HttpStatus.OK)
  @Post('users/:id/suspend')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('user:suspend')
  async suspendUser(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: SuspendUserDto,
  ) {
    return this.adminService.suspendUser(req.user.userId, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('users/:id/unsuspend')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('user:suspend')
  async unsuspendUser(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.adminService.unsuspendUser(req.user.userId, id);
  }

  @Get('properties/:propertyId')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('property:approve', 'property:reject')
  async getPropertyReviewDetail(@Param('propertyId') propertyId: string) {
    return this.adminService.getPropertyReviewDetail(propertyId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('requests/:requestId/review')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('request:approve', 'request:reject')
  async reviewRequest(
    @Request() req: { user: { userId: string } },
    @Param('requestId') requestId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminService.reviewRequest(req.user.userId, requestId, dto);
  }

  @Get('requests/:requestId')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('request:approve', 'request:reject')
  async getRequestReviewDetail(@Param('requestId') requestId: string) {
    return this.adminService.getRequestReviewDetail(requestId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('reviews/:reviewId/review')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('review:moderate')
  async reviewUserReview(
    @Request() req: { user: { userId: string } },
    @Param('reviewId') reviewId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminService.reviewUserReview(req.user.userId, dto, reviewId);
  }

  @Get('reviews/:reviewId')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('review:moderate')
  async getReviewDetail(@Param('reviewId') reviewId: string) {
    return this.adminService.getReviewDetail(reviewId);
  }

  @Get('login-history')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('audit:view')
  async getLoginHistory(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.getLoginHistory({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('audit-log')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('audit:view')
  async getAuditLog(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.getAuditLog({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  // Bootstrap-friendly: OptionalJwtAuthGuard lets the very first admin be
  // created when none exists; otherwise the service enforces super-admin.
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
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('admin:manage')
  async updateTeamMember(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: { role?: string; disabled?: boolean },
  ) {
    return this.adminService.updateTeamMember(req.user.userId, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('team/:id/reset-password')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('admin:manage')
  async resetPassword(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.adminService.resetAdminPassword(req.user.userId, id);
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getStats() {
    return this.adminService.getStats();
  }

  // Shared by the suspension console (search + pagination) and the
  // Active/Suspended-Deleted tabs (status filter) — either capability is
  // enough to view the list; the mutating routes below stay separately
  // capability-gated to their own action.
  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('user:suspend', 'user:delete')
  async listUsers(
    @Query('status') status?: 'active' | 'suspended' | 'deleted' | 'all',
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.listUsers({
      status,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Delete('users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('user:delete')
  async deleteUser(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.adminService.softDeleteUser(req.user.userId, id);
  }

  @Get('reactivations')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('user:reactivate')
  async listReactivations() {
    return this.adminService.listReactivationRequests();
  }

  @HttpCode(HttpStatus.OK)
  @Post('reactivations/:id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('user:reactivate')
  async approveReactivation(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.adminService.approveReactivation(req.user.userId, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('reactivations/:id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
  @Roles('ADMIN')
  @RequireCapability('user:reactivate')
  async rejectReactivation(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.adminService.rejectReactivation(req.user.userId, id);
  }
}
