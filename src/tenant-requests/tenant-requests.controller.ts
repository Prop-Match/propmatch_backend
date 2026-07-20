import {
  Body,
  Controller,
  Get,
  Param,
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
@Controller('tenant/requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantRequestsController {
  constructor(private readonly tenantRequestsService: TenantRequestsService) {}

  @Get()
  @Roles('TENANT')
  async findMine(@Request() req: { user: { userId: string } }) {
    return this.tenantRequestsService.findMine(req.user.userId);
  }

  @Post()
  @Roles('TENANT')
  @UseGuards(VerifiedGuard)
  async create(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreateTenantRequestDto,
  ) {
    return this.tenantRequestsService.create(req.user.userId, dto);
  }

  @Post(':id/close')
  @Roles('TENANT')
  async close(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.tenantRequestsService.close(req.user.userId, id);
  }
}
