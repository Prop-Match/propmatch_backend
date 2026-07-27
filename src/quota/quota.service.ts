import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * PRO-18 — Freemium enforcement & quota limits (Ali, Week 3).
 *
 * Centralises the "count uses, block at zero, trigger the paywall" logic. The
 * server is the entitlement authority — the client only mirrors these numbers.
 *
 * A blocked action throws a coded 403 that the frontend recognises and turns
 * into the Paymob paywall for the given `paymentType`:
 *   { code: 'QUOTA_EXHAUSTED', trigger: 'payment', paymentType, priceEgp }
 *
 * The listing quota (freeListingsLeft) and offer quota (freeOffersLeft) are
 * consumed inline in their own services; the optimizer quota lives here.
 */
@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Prices (EGP) per top-up product — mirrors the frontend PaymentType map. */
  private static readonly PRICES = {
    NEW_LISTING: 100,
    BOOST_LISTING: 75,
    REFILL_MATCHES: 30,
    OFFER_PACK: 50,
  } as const;

  private exhausted(paymentType: keyof typeof QuotaService.PRICES): never {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'QUOTA_EXHAUSTED',
      message: 'انتهت محاولاتك المجانية',
      trigger: 'payment',
      paymentType,
      priceEgp: QuotaService.PRICES[paymentType],
    });
  }

  /**
   * The user's quota, or null for a user with no quota row (tenants). Matches
   * the frontend `UserQuota` contract — the UI must tolerate null.
   */
  async getQuota(userId: string) {
    const q = await this.prisma.userQuota.findUnique({ where: { userId } });
    if (!q) return null;
    return {
      planType: q.planType,
      planExpiresAt: q.planExpiresAt ? q.planExpiresAt.toISOString() : null,
      maxActiveListings: q.maxActiveListings,
      freeListingsLeft: q.freeListingsLeft,
      optimizerUsesLeft: q.optimizerUsesLeft,
      freeOffersLeft: q.freeOffersLeft,
      lastResetDate: q.lastResetDate.toISOString(),
    };
  }

  /**
   * PRO-10 — spend one AI-optimizer use. Throws QUOTA_EXHAUSTED (→ REFILL_MATCHES
   * paywall) when none are left. Called BEFORE the stream opens, so the block is
   * a JSON 403 the client can act on rather than a committed 200 SSE stream.
   *
   * Spent up-front: a user who disconnects mid-generation still consumed it,
   * which matches the frontend's optimizer behaviour.
   */
  async consumeOptimizer(userId: string): Promise<number> {
    const quota = await this.prisma.userQuota.findUnique({ where: { userId } });
    if (!quota || quota.optimizerUsesLeft <= 0) this.exhausted('REFILL_MATCHES');

    const updated = await this.prisma.userQuota.update({
      where: { userId },
      data: { optimizerUsesLeft: { decrement: 1 } },
    });
    return updated.optimizerUsesLeft;
  }
}
