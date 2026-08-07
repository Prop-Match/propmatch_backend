import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FREE_ACTIVE_LISTING_LIMIT,
  FREE_OFFERS_MONTHLY_ALLOTMENT,
  PREMIUM_ACTIVE_LISTING_LIMIT,
  PRICING_CATALOG,
} from '../payments/pricing.catalog';

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
 * A free offer is one landlord-initiated offer against an approved tenant
 * request. Premium owners have unlimited initiated offers while subscribed.
 */
@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  private optimizerExhausted(): never {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'QUOTA_EXHAUSTED',
      message: 'انتهت محاولاتك المجانية',
      trigger: 'payment',
      paymentType: 'AI_ADDON',
      priceEgp: PRICING_CATALOG.AI_ADDON.priceEgp,
    });
  }

  /**
   * The user's quota, or null for a user with no quota row (tenants). Matches
   * the frontend `UserQuota` contract — the UI must tolerate null.
   */
  async getQuota(userId: string) {
    let q = await this.prisma.userQuota.findUnique({ where: { userId } });
    if (!q) {
      q = await this.prisma.userQuota.create({
        data: {
          userId,
          freeListingsLeft: 1,
          freeOffersLeft: FREE_OFFERS_MONTHLY_ALLOTMENT,
          optimizerUsesLeft: 3,
          planType: 'FREE',
          maxActiveListings: 1,
        },
      });
    }

    const now = new Date();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    // Check plan expiration
    let currentPlanType = q.planType;
    if (
      q.planExpiresAt &&
      q.planExpiresAt.getTime() < now.getTime() &&
      q.planType !== 'FREE'
    ) {
      currentPlanType = 'FREE';
    }

    // Monthly Auto-Renewal with Carryover
    const daysSinceReset = now.getTime() - q.lastResetDate.getTime();
    if (daysSinceReset >= THIRTY_DAYS_MS) {
      // Carry over unused quota + add monthly allotment (3 optimizer, 5 offers)
      const newOptimizer = q.optimizerUsesLeft + 3;
      const newOffers = q.freeOffersLeft + FREE_OFFERS_MONTHLY_ALLOTMENT;

      q = await this.prisma.userQuota.update({
        where: { userId },
        data: {
          optimizerUsesLeft: newOptimizer,
          freeOffersLeft: newOffers,
          planType: currentPlanType,
          lastResetDate: now,
        },
      });
    } else if (currentPlanType !== q.planType) {
      q = await this.prisma.userQuota.update({
        where: { userId },
        data: { planType: currentPlanType },
      });
    }

    const isPremium = q.planType === 'PREMIUM';
    const isOwnerPlus = q.planType === 'OWNER_PLUS';

    const activeUnitLimit = isPremium ? 5 : isOwnerPlus ? 3 : 1;
    const activeUnitCount = await this.prisma.property.count({
      where: {
        ownerId: userId,
        status: { in: ['PENDING', 'APPROVED'] },
      },
    });

    return {
      planType: q.planType,
      planExpiresAt: q.planExpiresAt ? q.planExpiresAt.toISOString() : null,
      maxActiveListings: activeUnitLimit,
      activeUnitCount,
      freeListingsLeft: q.freeListingsLeft,
      optimizerUsesLeft: q.optimizerUsesLeft,
      freeOffersLeft: q.freeOffersLeft,
      lastResetDate: q.lastResetDate.toISOString(),
    };
  }

  /**
   * Spend one AI allowance use. Throws QUOTA_EXHAUSTED (→ AI_ADDON
   * paywall) when none are left. Called BEFORE the stream opens, so the block is
   * a JSON 403 the client can act on rather than a committed 200 SSE stream.
   *
   * Spent up-front: a user who disconnects mid-generation still consumed it,
   * which matches the frontend's optimizer behaviour.
   */
  async consumeOptimizer(userId: string): Promise<number> {
    const spent = await this.prisma.userQuota.updateMany({
      where: { userId, optimizerUsesLeft: { gt: 0 } },
      data: { optimizerUsesLeft: { decrement: 1 } },
    });
    if (spent.count !== 1) this.optimizerExhausted();
    const updated = await this.prisma.userQuota.findUniqueOrThrow({
      where: { userId },
      select: { optimizerUsesLeft: true },
    });
    return updated.optimizerUsesLeft;
  }
}
