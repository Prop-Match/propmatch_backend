import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
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
  @Roles('LANDLORD')
  @UseGuards(VerifiedGuard)
  async create(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreatePropertyDto,
  ) {
    return this.propertiesService.create(req.user.userId, dto);
  }

  @Get('properties')
  async getAllProperties() {
    return this.propertiesService.getAll();
  }

}
