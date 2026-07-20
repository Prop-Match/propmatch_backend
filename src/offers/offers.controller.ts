import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { OffersService } from './offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * PRO-12/13 — owner offers.
 *
 * Routes:
 *   POST /api/landlord/offers  — send an offer (verified LANDLORD, costs quota)
 *   GET  /api/landlord/offers  — offers this landlord has sent
 */
@Controller('landlord/offers')
@UseGuards(JwtAuthGuard, RolesGuard, VerifiedGuard)
@Roles('LANDLORD')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Post()
  async send(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreateOfferDto,
  ) {
    return this.offersService.sendOffer(req.user.userId, dto);
  }

  @Get()
  async sent(@Request() req: { user: { userId: string } }) {
    return this.offersService.getSentOffers(req.user.userId);
  }
}
