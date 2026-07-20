import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller()
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  /**
   * POST /api/landlord/properties
   *
   * Creates a new property listing for the authenticated landlord.
   * Requires JWT auth + LANDLORD role + APPROVED identity verification.
   * Gates: free listing quota must be > 0.
   */
  @Post('landlord/properties')
  @UseGuards(JwtAuthGuard, RolesGuard, VerifiedGuard)
  @Roles('LANDLORD')
  async create(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreatePropertyDto,
  ) {
    return this.propertiesService.create(req.user.userId, dto);
  }

  /**
   * GET /api/properties — hybrid search / browse (PRO-11).
   *
   * Public on purpose: anonymous tenants browse without logging in (the
   * frontend gates only their own surfaces, not browse). Returns summaries —
   * never owner PII.
   */
  @Get('properties')
  async search(@Query() query: SearchPropertiesDto) {
    return this.propertiesService.search(query);
  }

  @Get('properties/:id')
  async getPropertyById(@Param('id') id: string) {
    return this.propertiesService.getPropertyById(id);
  }
}
