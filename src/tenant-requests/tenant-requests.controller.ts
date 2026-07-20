import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { TenantRequestsService } from './tenant-requests.service';
import { CreateTenantRequestDto } from './dto/create-tenant-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * PRO-05 — Tenant requests (reverse marketplace).
 *
 * Route: POST /api/tenant/requests
 * The frontend calls `api.post("tenant/requests", body)` →
 * BFF proxy → NestJS `POST /api/tenant/requests`.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, VerifiedGuard)
export class TenantRequestsController {
  constructor(
    private readonly tenantRequestsService: TenantRequestsService,
  ) {}

  @Post('tenant/requests')
  @Roles('TENANT')
  async create(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreateTenantRequestDto,
  ) {
    return this.tenantRequestsService.create(req.user.userId, dto);
  }

}
