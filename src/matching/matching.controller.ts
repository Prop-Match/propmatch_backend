import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * PRO-13 — the matchmaker from the landlord's side.
 *
 * Route: GET /api/landlord/requests
 * Verified LANDLORD only — the frontend expects a 403 VERIFICATION_REQUIRED
 * for an unverified landlord (VerifiedGuard supplies exactly that).
 */
@Controller('landlord/requests')
@UseGuards(JwtAuthGuard, RolesGuard, VerifiedGuard)
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Get()
  @Roles('LANDLORD')
  async browse(@Request() req: { user: { userId: string } }) {
    return this.matchingService.browsableRequestsForLandlord(req.user.userId);
  }
}
