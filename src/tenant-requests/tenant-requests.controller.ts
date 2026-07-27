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
import { ExtractTenantRequestDto } from './dto/extract-tenant-request.dto';
import { TenantRequestExtractionService } from './tenant-request-extraction.service';
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
  constructor(
    private readonly tenantRequestsService: TenantRequestsService,
    private readonly tenantRequestExtractionService: TenantRequestExtractionService,
  ) {}

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

  /** Returns reviewable suggestions only; it never persists a tenant request. */
  @Post('extract')
  @Roles('TENANT')
  @UseGuards(VerifiedGuard)
  async extract(@Body() dto: ExtractTenantRequestDto) {
    return this.tenantRequestExtractionService.extract(dto.text);
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
