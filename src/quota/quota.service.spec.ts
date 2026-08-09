/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment */
import { PrismaService } from '../../prisma/prisma.service';
import { QuotaService } from './quota.service';
import { CommercialConfigService } from '../commercial-config/commercial-config.service';
import { planAllowances } from '../payments/pricing.catalog';

const commercialConfig = {
  getPlanAllowances: jest.fn(
    async (planType: 'FREE' | 'OWNER_PLUS' | 'PREMIUM') => ({
      ...planAllowances(planType),
      boostDurationDays: 7,
    }),
  ),
  getProduct: jest.fn(async () => ({ priceEgp: 39 })),
} as unknown as CommercialConfigService;

describe('QuotaService commercial periods', () => {
  it('resets Premium allowances without carrying unused quota', async () => {
    const state = {
      userId: 'owner-1',
      planType: 'PREMIUM' as const,
      planExpiresAt: new Date('2027-08-01T00:00:00.000Z'),
      billingInterval: 'YEARLY' as const,
      currentPeriodStartsAt: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEndsAt: new Date('2026-07-01T00:00:00.000Z'),
      maxActiveListings: 10,
      freeListingsLeft: 0,
      optimizerUsesLeft: 27,
      freeOffersLeft: 91,
      boostCreditsLeft: 1,
      listingGraceEndsAt: null,
      pendingPlanType: null,
      pendingBillingInterval: null,
      pendingPlanStartsAt: null,
      pendingPlanExpiresAt: null,
      lastResetDate: new Date('2026-06-01T00:00:00.000Z'),
    };
    const update = jest.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state, data);
        return state;
      },
    );
    const prisma = {
      userQuota: {
        findUnique: jest.fn(async () => state),
        update,
      },
      entitlementGrant: {
        aggregate: jest.fn(async () => ({ _sum: { remainingQuantity: null } })),
      },
      property: { count: jest.fn(async () => 0) },
    } as unknown as PrismaService;

    const quota = await new QuotaService(prisma, commercialConfig).getQuota(
      'owner-1',
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          freeOffersLeft: 100,
          optimizerUsesLeft: 30,
          boostCreditsLeft: 2,
        }),
      }),
    );
    expect(quota).toMatchObject({
      planType: 'PREMIUM',
      freeOffersLeft: 100,
      optimizerUsesLeft: 30,
      boostCreditsLeft: 2,
    });
  });

  it('consumes the add-on that expires before the plan period', async () => {
    const now = new Date();
    const state = {
      userId: 'owner-1',
      planType: 'FREE' as const,
      planExpiresAt: null,
      billingInterval: null,
      currentPeriodStartsAt: now,
      currentPeriodEndsAt: new Date(now.getTime() + 20 * 86_400_000),
      maxActiveListings: 1,
      freeListingsLeft: 0,
      optimizerUsesLeft: 5,
      freeOffersLeft: 5,
      boostCreditsLeft: 0,
      listingGraceEndsAt: null,
      pendingPlanType: null,
      pendingBillingInterval: null,
      pendingPlanStartsAt: null,
      pendingPlanExpiresAt: null,
      lastResetDate: now,
    };
    const grant = {
      id: 'grant-1',
      expiresAt: new Date(now.getTime() + 86_400_000),
      remainingQuantity: 2,
    };
    const grantUpdate = jest.fn(async () => {
      grant.remainingQuantity -= 1;
      return { count: 1 };
    });
    const quotaUpdate = jest.fn(async () => ({ count: 1 }));
    const tx = {
      userQuota: {
        findUniqueOrThrow: jest.fn(async () => state),
        updateMany: quotaUpdate,
      },
      entitlementGrant: {
        findFirst: jest.fn(async () => grant),
        updateMany: grantUpdate,
        aggregate: jest.fn(async () => ({
          _sum: { remainingQuantity: grant.remainingQuantity },
        })),
      },
    };
    const prisma = {
      userQuota: { findUnique: jest.fn(async () => state) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;

    await expect(
      new QuotaService(prisma, commercialConfig).consumeOptimizer('owner-1'),
    ).resolves.toBe(6);
    expect(grantUpdate).toHaveBeenCalledWith({
      where: { id: 'grant-1', remainingQuantity: { gt: 0 } },
      data: { remainingQuantity: { decrement: 1 } },
    });
    expect(quotaUpdate).not.toHaveBeenCalled();
  });
});
