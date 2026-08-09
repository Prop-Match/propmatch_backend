import { ForbiddenException, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from 'generated/prisma/client';
import {
  LISTING_CAPACITY_GRACE_DAYS,
  type OwnerPlanName,
} from '../payments/pricing.catalog';
import { CommercialConfigService } from '../commercial-config/commercial-config.service';

const DAY_MS = 24 * 60 * 60 * 1_000;

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

function addMonth(value: Date): Date {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

type ConsumableType = 'MATCHED_OFFER' | 'AI_OPTIMIZER_USE';

/**
 * Server-authoritative commercial entitlements.
 *
 * Plan allowances are monthly, never carry over, and are mirrored in
 * UserQuota for backward-compatible clients. Add-ons are independent grants
 * with their own expiry and are consumed in soonest-expiring-first order.
 */
@Injectable()
export class QuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commercialConfig: CommercialConfigService,
  ) {}

  private async quotaExhausted(
    message: string,
    paymentType: 'AI_USES_10_90D' | 'OFFERS_10_60D',
  ): Promise<never> {
    const product = await this.commercialConfig.getProduct(paymentType);
    throw new ForbiddenException({
      statusCode: 403,
      code: 'QUOTA_EXHAUSTED',
      message,
      trigger: 'payment',
      paymentType,
      priceEgp: product.priceEgp,
    });
  }

  private async ensureCurrentPeriod(userId: string) {
    const now = new Date();
    let quota = await this.prisma.userQuota.findUnique({ where: { userId } });

    if (!quota) {
      const allowances = await this.commercialConfig.getPlanAllowances('FREE');
      quota = await this.prisma.userQuota.create({
        data: {
          userId,
          planType: 'FREE',
          maxActiveListings: allowances.activeListings,
          freeOffersLeft: allowances.offers,
          optimizerUsesLeft: allowances.aiUses,
          boostCreditsLeft: allowances.boostCredits,
          currentPeriodStartsAt: now,
          currentPeriodEndsAt: addMonth(now),
          lastResetDate: now,
        },
      });
      return quota;
    }

    const planExpired =
      quota.planType !== 'FREE' &&
      (!quota.planExpiresAt || quota.planExpiresAt <= now);
    const activatePendingPlan =
      planExpired &&
      quota.pendingPlanType !== null &&
      quota.pendingPlanStartsAt !== null &&
      quota.pendingPlanStartsAt <= now &&
      quota.pendingPlanExpiresAt !== null &&
      quota.pendingPlanExpiresAt > now;
    const effectivePlan: OwnerPlanName = activatePendingPlan
      ? quota.pendingPlanType!
      : planExpired
        ? 'FREE'
        : quota.planType;
    const effectivePlanExpiresAt = activatePendingPlan
      ? quota.pendingPlanExpiresAt
      : planExpired
        ? null
        : quota.planExpiresAt;
    const periodExpired =
      !quota.currentPeriodEndsAt || quota.currentPeriodEndsAt <= now;

    if (planExpired || periodExpired || !quota.currentPeriodStartsAt) {
      const allowances =
        await this.commercialConfig.getPlanAllowances(effectivePlan);
      const currentPeriodStartsAt = now;
      let currentPeriodEndsAt = addMonth(now);
      if (
        effectivePlan !== 'FREE' &&
        effectivePlanExpiresAt &&
        effectivePlanExpiresAt < currentPeriodEndsAt
      ) {
        currentPeriodEndsAt = effectivePlanExpiresAt;
      }

      quota = await this.prisma.userQuota.update({
        where: { userId },
        data: {
          planType: effectivePlan,
          planExpiresAt: effectivePlanExpiresAt,
          billingInterval: activatePendingPlan
            ? quota.pendingBillingInterval
            : planExpired
              ? null
              : quota.billingInterval,
          pendingPlanType: activatePendingPlan ? null : quota.pendingPlanType,
          pendingBillingInterval: activatePendingPlan
            ? null
            : quota.pendingBillingInterval,
          pendingPlanStartsAt: activatePendingPlan
            ? null
            : quota.pendingPlanStartsAt,
          pendingPlanExpiresAt: activatePendingPlan
            ? null
            : quota.pendingPlanExpiresAt,
          maxActiveListings: allowances.activeListings,
          freeOffersLeft: allowances.offers,
          optimizerUsesLeft: allowances.aiUses,
          boostCreditsLeft: allowances.boostCredits,
          currentPeriodStartsAt,
          currentPeriodEndsAt,
          lastResetDate: now,
        },
      });
    }
    return quota;
  }

  private async activeGrantQuantity(
    userId: string,
    type: 'ACTIVE_LISTING' | ConsumableType,
  ): Promise<number> {
    const aggregate = await this.prisma.entitlementGrant.aggregate({
      where: {
        userId,
        type,
        startsAt: { lte: new Date() },
        expiresAt: { gt: new Date() },
        remainingQuantity: { gt: 0 },
      },
      _sum: { remainingQuantity: true },
    });
    return aggregate._sum.remainingQuantity ?? 0;
  }

  async getListingCapacity(userId: string): Promise<{
    planType: OwnerPlanName;
    activeUnitLimit: number;
    activeUnitCount: number;
    listingGraceEndsAt: Date | null;
  }> {
    let quota = await this.ensureCurrentPeriod(userId);
    const addOnListings = await this.activeGrantQuantity(
      userId,
      'ACTIVE_LISTING',
    );
    const activeUnitLimit = quota.maxActiveListings + addOnListings;
    const activeUnitCount = await this.prisma.property.count({
      where: { ownerId: userId, status: { in: ['PENDING', 'APPROVED'] } },
    });

    if (activeUnitCount > activeUnitLimit && !quota.listingGraceEndsAt) {
      quota = await this.prisma.userQuota.update({
        where: { userId },
        data: {
          listingGraceEndsAt: addDays(new Date(), LISTING_CAPACITY_GRACE_DAYS),
        },
      });
    } else if (activeUnitCount <= activeUnitLimit && quota.listingGraceEndsAt) {
      quota = await this.prisma.userQuota.update({
        where: { userId },
        data: { listingGraceEndsAt: null },
      });
    }

    return {
      planType: quota.planType,
      activeUnitLimit,
      activeUnitCount,
      listingGraceEndsAt: quota.listingGraceEndsAt,
    };
  }

  async getQuota(userId: string) {
    const quota = await this.ensureCurrentPeriod(userId);
    const [capacity, addOnOffers, addOnAi, allowances] = await Promise.all([
      this.getListingCapacity(userId),
      this.activeGrantQuantity(userId, 'MATCHED_OFFER'),
      this.activeGrantQuantity(userId, 'AI_OPTIMIZER_USE'),
      this.commercialConfig.getPlanAllowances(quota.planType),
    ]);

    return {
      planType: quota.planType,
      billingInterval: quota.billingInterval,
      planExpiresAt: quota.planExpiresAt?.toISOString() ?? null,
      currentPeriodStartsAt: quota.currentPeriodStartsAt?.toISOString() ?? null,
      currentPeriodEndsAt: quota.currentPeriodEndsAt?.toISOString() ?? null,
      maxActiveListings: capacity.activeUnitLimit,
      activeUnitCount: capacity.activeUnitCount,
      listingGraceEndsAt: capacity.listingGraceEndsAt?.toISOString() ?? null,
      freeListingsLeft: Math.max(
        0,
        capacity.activeUnitLimit - capacity.activeUnitCount,
      ),
      optimizerUsesLeft: quota.optimizerUsesLeft + addOnAi,
      freeOffersLeft: quota.freeOffersLeft + addOnOffers,
      boostCreditsLeft: quota.boostCreditsLeft,
      boostCreditDurationDays: allowances.boostDurationDays,
      lastResetDate: quota.lastResetDate.toISOString(),
    };
  }

  private async consumeSoonestExpiringWithClient(
    tx: Prisma.TransactionClient,
    userId: string,
    type: ConsumableType,
    quotaField: 'freeOffersLeft' | 'optimizerUsesLeft',
  ): Promise<number | null> {
    const now = new Date();
    const [quota, grant] = await Promise.all([
      tx.userQuota.findUniqueOrThrow({ where: { userId } }),
      tx.entitlementGrant.findFirst({
        where: {
          userId,
          type,
          startsAt: { lte: now },
          expiresAt: { gt: now },
          remainingQuantity: { gt: 0 },
        },
        orderBy: { expiresAt: 'asc' },
      }),
    ]);

    const planExpiresAt = quota.currentPeriodEndsAt ?? now;
    const consumeGrantFirst =
      grant && (quota[quotaField] <= 0 || grant.expiresAt < planExpiresAt);

    if (consumeGrantFirst) {
      const changed = await tx.entitlementGrant.updateMany({
        where: { id: grant.id, remainingQuantity: { gt: 0 } },
        data: { remainingQuantity: { decrement: 1 } },
      });
      if (changed.count !== 1) return null;
    } else {
      const changed = await tx.userQuota.updateMany({
        where: { userId, [quotaField]: { gt: 0 } },
        data: { [quotaField]: { decrement: 1 } },
      });
      if (changed.count !== 1) return null;
    }

    const [updatedQuota, grants] = await Promise.all([
      tx.userQuota.findUniqueOrThrow({ where: { userId } }),
      tx.entitlementGrant.aggregate({
        where: {
          userId,
          type,
          startsAt: { lte: now },
          expiresAt: { gt: now },
          remainingQuantity: { gt: 0 },
        },
        _sum: { remainingQuantity: true },
      }),
    ]);
    return updatedQuota[quotaField] + (grants._sum.remainingQuantity ?? 0);
  }

  private async consumeSoonestExpiring(
    userId: string,
    type: ConsumableType,
    quotaField: 'freeOffersLeft' | 'optimizerUsesLeft',
  ): Promise<number> {
    await this.ensureCurrentPeriod(userId);
    const remaining = await this.prisma.$transaction((tx) =>
      this.consumeSoonestExpiringWithClient(tx, userId, type, quotaField),
    );
    return remaining ?? -1;
  }

  async consumeOptimizer(userId: string): Promise<number> {
    const remaining = await this.consumeSoonestExpiring(
      userId,
      'AI_OPTIMIZER_USE',
      'optimizerUsesLeft',
    );
    if (remaining < 0) {
      await this.quotaExhausted(
        'انتهت محاولات تحسين الوصف المتاحة',
        'AI_USES_10_90D',
      );
    }
    return remaining;
  }

  async consumeOffer(userId: string): Promise<number> {
    const remaining = await this.consumeSoonestExpiring(
      userId,
      'MATCHED_OFFER',
      'freeOffersLeft',
    );
    if (remaining < 0) {
      await this.quotaExhausted('انتهت العروض المتاحة', 'OFFERS_10_60D');
    }
    return remaining;
  }

  /** Consume an offer and create its record in one database transaction. */
  async withConsumedOffer<T>(
    userId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<{ value: T; remaining: number }> {
    await this.ensureCurrentPeriod(userId);
    return this.prisma.$transaction(async (tx) => {
      const remaining = await this.consumeSoonestExpiringWithClient(
        tx,
        userId,
        'MATCHED_OFFER',
        'freeOffersLeft',
      );
      if (remaining === null) {
        await this.quotaExhausted('انتهت العروض المتاحة', 'OFFERS_10_60D');
      }
      const value = await operation(tx);
      return { value, remaining: remaining! };
    });
  }

  async consumeBoostCredit(userId: string): Promise<number> {
    await this.ensureCurrentPeriod(userId);
    const product = await this.commercialConfig.getProduct('BOOST_7D');
    const spent = await this.prisma.userQuota.updateMany({
      where: { userId, boostCreditsLeft: { gt: 0 } },
      data: { boostCreditsLeft: { decrement: 1 } },
    });
    if (spent.count !== 1) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'QUOTA_EXHAUSTED',
        message: 'لا يوجد رصيد Boost متاح في خطتك',
        trigger: 'payment',
        paymentType: 'BOOST_7D',
        priceEgp: product.priceEgp,
      });
    }
    const quota = await this.prisma.userQuota.findUniqueOrThrow({
      where: { userId },
      select: { boostCreditsLeft: true },
    });
    return quota.boostCreditsLeft;
  }

  async activatePlanBoost(userId: string, propertyId: string) {
    const currentQuota = await this.ensureCurrentPeriod(userId);
    const [plan, product] = await Promise.all([
      this.commercialConfig.getPlanAllowances(currentQuota.planType),
      this.commercialConfig.getProduct('BOOST_7D'),
    ]);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, ownerId: userId, status: 'APPROVED' },
        select: { id: true },
      });
      if (!property) throw new ForbiddenException('العقار غير مؤهل للترقية');

      const spent = await tx.userQuota.updateMany({
        where: { userId, boostCreditsLeft: { gt: 0 } },
        data: { boostCreditsLeft: { decrement: 1 } },
      });
      if (spent.count !== 1) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'QUOTA_EXHAUSTED',
          message: 'لا يوجد رصيد Boost متاح في خطتك',
          trigger: 'payment',
          paymentType: 'BOOST_7D',
          priceEgp: product.priceEgp,
        });
      }

      const latestCampaign = await tx.boostCampaign.findFirst({
        where: {
          propertyId,
          status: { in: ['ACTIVE', 'SCHEDULED'] },
          endsAt: { gt: now },
        },
        orderBy: { endsAt: 'desc' },
      });
      const startsAt = latestCampaign?.endsAt ?? now;
      const endsAt = addDays(startsAt, plan.boostDurationDays);
      const campaign = await tx.boostCampaign.create({
        data: {
          propertyId,
          userId,
          productSku: 'PLAN_BOOST_7D',
          durationDays: plan.boostDurationDays,
          startsAt,
          endsAt,
          status: startsAt <= now ? 'ACTIVE' : 'SCHEDULED',
        },
      });
      await tx.property.update({
        where: { id: propertyId },
        data: { isBoosted: true, boostedUntil: endsAt },
      });
      const quota = await tx.userQuota.findUniqueOrThrow({
        where: { userId },
        select: { boostCreditsLeft: true },
      });
      return {
        campaignId: campaign.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        boostCreditsLeft: quota.boostCreditsLeft,
      };
    });
  }

  /** Active paid subscriptions only; add-on purchases do not affect priority. */
  async getCommercialPriority(userId: string) {
    const quota = await this.ensureCurrentPeriod(userId);
    if (quota.planType === 'PREMIUM') {
      return { tier: 'PREMIUM' as const, weight: 2 };
    }
    if (quota.planType === 'OWNER_PLUS') {
      return { tier: 'OWNER_PLUS' as const, weight: 1 };
    }
    return { tier: 'FREEMIUM' as const, weight: 0 };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async expireEntitlementsAndEnforceCapacity(): Promise<void> {
    const quotas = await this.prisma.userQuota.findMany({
      select: { userId: true },
    });
    for (const { userId } of quotas) {
      const capacity = await this.getListingCapacity(userId);
      if (
        capacity.listingGraceEndsAt &&
        capacity.listingGraceEndsAt <= new Date() &&
        capacity.activeUnitCount > capacity.activeUnitLimit
      ) {
        const excess = capacity.activeUnitCount - capacity.activeUnitLimit;
        const newest = await this.prisma.property.findMany({
          where: {
            ownerId: userId,
            status: { in: ['PENDING', 'APPROVED'] },
          },
          orderBy: { createdAt: 'desc' },
          take: excess,
          select: { id: true },
        });
        await this.prisma.property.updateMany({
          where: { id: { in: newest.map(({ id }) => id) } },
          data: { status: 'ARCHIVED' },
        });
        await this.prisma.userQuota.update({
          where: { userId },
          data: { listingGraceEndsAt: null },
        });
      }
    }
  }
}
