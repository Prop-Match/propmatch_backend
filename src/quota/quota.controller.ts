import { Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { QuotaService } from './quota.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * PRO-18 — quota status (Ali, Week 3).
 *
 * Route: GET /api/quota
 * The frontend reads this to render the quota chip. Returns the authed user's
 * quota, or null for users without a quota row (tenants) — the UI tolerates it.
 */
@Controller('quota')
@UseGuards(JwtAuthGuard)
export class QuotaController {
  constructor(private readonly quotaService: QuotaService) {}

  @Get()
  async getMyQuota(@Request() req: { user: { userId: string } }) {
    return this.quotaService.getQuota(req.user.userId);
  }

  @Post('documentation-pack/consume')
  async consumeDocumentationPack(@Request() req: { user: { userId: string } }) {
    return this.quotaService.consumeDocumentationPack(req.user.userId);
  }
}
