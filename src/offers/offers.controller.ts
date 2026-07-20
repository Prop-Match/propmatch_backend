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
import { OffersService } from './offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';

type AuthedRequest = { user: { userId: string } };

/** PRO-12/13 — the landlord ↔ tenant offer exchange (reverse marketplace). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get('landlord/requests')
  @Roles('LANDLORD')
  @UseGuards(VerifiedGuard)
  browseRequests(@Request() req: AuthedRequest) {
    return this.offersService.browseRequests(req.user.userId);
  }

  @Get('landlord/offers')
  @Roles('LANDLORD')
  getSentOffers(@Request() req: AuthedRequest) {
    return this.offersService.getSentOffers(req.user.userId);
  }

  @Post('landlord/offers')
  @Roles('LANDLORD')
  @UseGuards(VerifiedGuard)
  createOffer(@Request() req: AuthedRequest, @Body() dto: CreateOfferDto) {
    return this.offersService.createOffer(req.user.userId, dto);
  }

  @Get('tenant/offers')
  @Roles('TENANT')
  getReceivedOffers(@Request() req: AuthedRequest) {
    return this.offersService.getReceivedOffers(req.user.userId);
  }

  @Post('tenant/offers/:id/view')
  @Roles('TENANT')
  viewOffer(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.offersService.viewOffer(req.user.userId, id);
  }

  @Post('tenant/offers/:id/accept')
  @Roles('TENANT')
  @UseGuards(VerifiedGuard)
  acceptOffer(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.offersService.acceptOffer(req.user.userId, id);
  }

  @Post('tenant/offers/:id/reject')
  @Roles('TENANT')
  rejectOffer(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.offersService.rejectOffer(req.user.userId, id);
  }
}
