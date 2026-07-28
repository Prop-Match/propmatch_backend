import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantOffersService } from './tenant-offers.service';
import { CounterOfferDto, CreateTenantOfferDto } from './dto/tenant-offer.dto';

type AuthedRequest = { user: { userId: string } };

/**
 * Forward marketplace: tenants offer directly on listings; landlords
 * accept / decline / counter. Verified identity is required to create an offer
 * or accept (both can lead to contact reveal), mirroring the reverse-offer flow.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class TenantOffersController {
  constructor(private readonly service: TenantOffersService) {}

  // --- tenant side ---

  @Post('tenant/listing-offers')
  @Roles('TENANT')
  @UseGuards(VerifiedGuard)
  create(@Request() req: AuthedRequest, @Body() dto: CreateTenantOfferDto) {
    return this.service.create(req.user.userId, dto);
  }

  @Get('tenant/listing-offers')
  @Roles('TENANT')
  listMine(@Request() req: AuthedRequest) {
    return this.service.listForTenant(req.user.userId);
  }

  @Post('tenant/listing-offers/:id/accept')
  @Roles('TENANT')
  @UseGuards(VerifiedGuard)
  acceptCounter(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.service.tenantAccept(req.user.userId, id);
  }

  @Post('tenant/listing-offers/:id/withdraw')
  @Roles('TENANT')
  withdraw(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.service.tenantWithdraw(req.user.userId, id);
  }

  // --- landlord side ---

  @Get('landlord/listing-offers')
  @Roles('LANDLORD')
  received(@Request() req: AuthedRequest) {
    return this.service.listForLandlord(req.user.userId);
  }

  @Post('landlord/listing-offers/:id/accept')
  @Roles('LANDLORD')
  @UseGuards(VerifiedGuard)
  accept(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.service.landlordAccept(req.user.userId, id);
  }

  @Post('landlord/listing-offers/:id/decline')
  @Roles('LANDLORD')
  decline(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.service.landlordDecline(req.user.userId, id);
  }

  @Post('landlord/listing-offers/:id/counter')
  @Roles('LANDLORD')
  counter(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: CounterOfferDto,
  ) {
    return this.service.landlordCounter(req.user.userId, id, dto);
  }
}
