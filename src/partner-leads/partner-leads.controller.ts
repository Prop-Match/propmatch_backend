import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { PartnerLeadsService } from './partner-leads.service';
import { CreatePartnerLeadDto } from './dto/create-partner-lead.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

/** POST /api/partner-leads (tenant-only; leads are keyed to a tenantId) -> { items }. */
@Controller('partner-leads')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TENANT', 'LANDLORD')
export class PartnerLeadsController {
  constructor(private readonly partnerLeadsService: PartnerLeadsService) {}

  @Post()
  create(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreatePartnerLeadDto,
  ) {
    return this.partnerLeadsService.create(req.user.userId, dto);
  }
}
