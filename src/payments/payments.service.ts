import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './../../prisma/prisma.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import {
  type BillablePaymentType,
  isBillablePaymentType,
  type OwnerPlanName,
  PRICING_CATALOG,
} from './pricing.catalog';
import { PaymobService } from './providers/paymob.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CommercialConfigService } from '../commercial-config/commercial-config.service';
import type { CatalogSnapshot } from '../commercial-config/commercial-config.types';
import { Prisma } from 'generated/prisma/client';

// Payments created before this catalog revision can still settle after the
// deployment. They must receive a compatible entitlement instead of becoming
// successful transactions with no value granted.
const SETTLEMENT_COMPATIBILITY: Partial<Record<string, BillablePaymentType>> = {
  PREMIUM_OWNER: 'PREMIUM_MONTHLY',
  OWNER_PLUS: 'OWNER_PLUS_MONTHLY',
  SINGLE_LISTING: 'EXTRA_LISTING_60D',
  SINGLE_OFFER: 'OFFERS_10_60D',
  BOOST_LISTING: 'BOOST_30D',
  AI_ADDON: 'AI_USES_10_90D',
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly gateway: PaymobService,
    private readonly realtime: RealtimeService,
    private readonly commercialConfig: CommercialConfigService,
  ) {}

  async checkout(
    userId: string,
    dto: CreateCheckoutDto,
  ): Promise<{
    providerOrderId: string;
    amount: number;
    currency: 'EGP';
    paymentType: BillablePaymentType;
    checkoutUrl: string;
  }> {
    if (!isBillablePaymentType(dto.paymentType)) {
      throw new BadRequestException('Unsupported payment type');
    }

    const productSemantics = PRICING_CATALOG[dto.paymentType];
    const snapshot = await this.commercialConfig.checkoutSnapshot(
      dto.paymentType,
    );
    const product = snapshot.product;
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (
      !user ||
      !productSemantics.allowedRoles.some((role) => role === user.role)
    ) {
      throw new ForbiddenException(
        'This product is not available to this role',
      );
    }

    if (product.kind === 'BOOST') {
      if (!dto.propertyId) {
        throw new BadRequestException('propertyId is required for a boost');
      }
      const property = await this.prismaService.property.findFirst({
        where: {
          id: dto.propertyId,
          ownerId: userId,
          status: 'APPROVED',
        },
        select: { id: true },
      });
      if (!property) {
        throw new NotFoundException('Eligible property not found');
      }
    }

    const { checkoutUrl, providerOrderId } =
      await this.gateway.generatePaymentUrl(
        userId,
        dto.paymentType,
        product.priceEgp,
        dto.method,
        dto.walletPhone,
      );

    await this.prismaService.paymentTransaction.create({
      data: {
        userId,
        providerOrderId,
        amount: product.priceEgp,
        paymentType: dto.paymentType,
        productSku: dto.paymentType,
        billingInterval:
          product.billing === 'MONTHLY' || product.billing === 'YEARLY'
            ? product.billing
            : null,
        targetPropertyId: dto.propertyId,
        catalogSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
      },
    });

    return {
      providerOrderId,
      amount: product.priceEgp,
      currency: 'EGP',
      paymentType: dto.paymentType,
      checkoutUrl,
    };
  }

  async handleWebhook(
    query: Record<string, string>,
    body: Record<string, unknown>,
  ): Promise<{ received: boolean }> {
    const result = this.gateway.processWebhook(query, body);
    if (!result.isValid) {
      throw new BadRequestException('Invalid signature');
    }

    let userId = result.userId;
    let paymentType = result.paymentType;
    let savedTransaction: { userId: string; providerOrderId: string } | null =
      null;

    if (result.providerOrderId) {
      const transaction =
        await this.prismaService.paymentTransaction.findUnique({
          where: { providerOrderId: result.providerOrderId },
        });
      if (transaction) {
        savedTransaction = transaction;
        // The signed provider order stored at checkout is authoritative. Never
        // grant an entitlement from client-controlled webhook metadata.
        userId = transaction.userId;
        paymentType = transaction.paymentType;
      }
    }

    if (result.success && userId && paymentType) {
      await this.processSuccessfulPayment(
        userId,
        paymentType,
        result.transactionId,
        result.providerOrderId,
      );
    } else if (result.isFinal && result.providerOrderId) {
      const updated = await this.prismaService.paymentTransaction.updateMany({
        where: { providerOrderId: result.providerOrderId, status: 'PENDING' },
        data: {
          status: 'FAILED',
          providerTransactionId: result.transactionId,
        },
      });
      if (updated.count === 1 && savedTransaction) {
        this.realtime.paymentUpdated(savedTransaction.userId, {
          providerOrderId: savedTransaction.providerOrderId,
          status: 'FAILED',
          providerTransactionId: result.transactionId,
          paidAt: null,
        });
      }
    }
    return { received: true };
  }

  async getTransaction(userId: string, providerOrderId: string) {
    const transaction = await this.prismaService.paymentTransaction.findFirst({
      where: { userId, providerOrderId },
    });
    if (!transaction) {
      throw new NotFoundException('Payment transaction not found');
    }
    return transaction;
  }

  private async processSuccessfulPayment(
    userId: string,
    paymentType: string,
    transactionId: string,
    providerOrderId?: string,
  ): Promise<void> {
    if (!providerOrderId) {
      this.logger.error('Successful Paymob callback has no provider order ID');
      return;
    }

    const paidAt = new Date();
    const applied = await this.prismaService.$transaction(async (tx) => {
      const claimed = await tx.paymentTransaction.updateMany({
        where: { providerOrderId, status: 'PENDING' },
        data: {
          status: 'SUCCESS',
          providerTransactionId: transactionId,
          paidAt,
        },
      });
      if (claimed.count === 0) return false;

      const transaction = await tx.paymentTransaction.findUniqueOrThrow({
        where: { providerOrderId },
      });
      const targetPropertyId = transaction.targetPropertyId;

      const catalogPaymentType = isBillablePaymentType(paymentType)
        ? paymentType
        : SETTLEMENT_COMPATIBILITY[paymentType];
      if (!catalogPaymentType) {
        this.logger.warn(
          `No entitlement granted for legacy payment: ${paymentType}`,
        );
        return;
      }

      let snapshot = this.commercialConfig.parseSnapshot(
        transaction.catalogSnapshot,
      );
      if (!snapshot) {
        const product =
          await this.commercialConfig.getProduct(catalogPaymentType);
        snapshot = {
          product,
          planAllowances: product.planType
            ? await this.commercialConfig.getPlanAllowances(product.planType)
            : undefined,
        } satisfies CatalogSnapshot;
      }
      const product = snapshot.product;

      if (product.kind === 'SUBSCRIPTION') {
        if (product.billing === 'ONE_TIME' || !product.planType) {
          throw new BadRequestException('Invalid subscription configuration');
        }
        const billingInterval = product.billing;
        const current = await tx.userQuota.findUnique({ where: { userId } });
        const targetPlan = product.planType as OwnerPlanName;
        const targetRank = targetPlan === 'PREMIUM' ? 2 : 1;
        const currentPlan = current?.planType ?? 'FREE';
        const currentRank =
          currentPlan === 'PREMIUM' ? 2 : currentPlan === 'OWNER_PLUS' ? 1 : 0;
        const currentIsActive =
          current?.planExpiresAt !== null &&
          current?.planExpiresAt !== undefined &&
          current.planExpiresAt > paidAt;
        const durationEnd = (start: Date) => {
          const end = new Date(start);
          if (billingInterval === 'YEARLY') {
            end.setUTCFullYear(end.getUTCFullYear() + 1);
          } else {
            end.setUTCMonth(end.getUTCMonth() + 1);
          }
          return end;
        };

        if (currentIsActive && targetRank < currentRank) {
          const pendingPlanStartsAt = current.planExpiresAt!;
          await tx.userQuota.update({
            where: { userId },
            data: {
              pendingPlanType: targetPlan,
              pendingBillingInterval: billingInterval,
              pendingPlanStartsAt,
              pendingPlanExpiresAt: durationEnd(pendingPlanStartsAt),
            },
          });
        } else if (currentIsActive && targetRank === currentRank) {
          const startsAt = current.planExpiresAt!;
          await tx.userQuota.update({
            where: { userId },
            data: {
              planExpiresAt: durationEnd(startsAt),
              billingInterval,
            },
          });
        } else {
          const allowances =
            snapshot.planAllowances ??
            (await this.commercialConfig.getPlanAllowances(targetPlan));
          const planExpiresAt = durationEnd(paidAt);
          const currentPeriodEndsAt = new Date(paidAt);
          currentPeriodEndsAt.setUTCMonth(
            currentPeriodEndsAt.getUTCMonth() + 1,
          );
          await tx.userQuota.upsert({
            where: { userId },
            create: {
              userId,
              planType: targetPlan,
              billingInterval,
              planExpiresAt,
              currentPeriodStartsAt: paidAt,
              currentPeriodEndsAt,
              lastResetDate: paidAt,
              maxActiveListings: allowances.activeListings,
              optimizerUsesLeft: allowances.aiUses,
              freeOffersLeft: allowances.offers,
              boostCreditsLeft: allowances.boostCredits,
            },
            update: {
              planType: targetPlan,
              billingInterval,
              planExpiresAt,
              currentPeriodStartsAt: paidAt,
              currentPeriodEndsAt,
              lastResetDate: paidAt,
              maxActiveListings: allowances.activeListings,
              optimizerUsesLeft: allowances.aiUses,
              freeOffersLeft: allowances.offers,
              boostCreditsLeft: allowances.boostCredits,
              pendingPlanType: null,
              pendingBillingInterval: null,
              pendingPlanStartsAt: null,
              pendingPlanExpiresAt: null,
            },
          });
        }
      } else if (product.kind === 'ENTITLEMENT') {
        if (
          !product.entitlementType ||
          !product.validityDays ||
          !product.quantity
        ) {
          throw new BadRequestException('Invalid entitlement configuration');
        }
        const expiresAt = new Date(
          paidAt.getTime() + product.validityDays! * 24 * 60 * 60 * 1_000,
        );
        const quantity = paymentType === 'SINGLE_OFFER' ? 1 : product.quantity!;
        await tx.entitlementGrant.create({
          data: {
            userId,
            paymentTransactionId: transaction.id,
            type: product.entitlementType,
            source: 'ADDON',
            productSku: paymentType,
            grantedQuantity: quantity,
            remainingQuantity: quantity,
            startsAt: paidAt,
            expiresAt,
          },
        });
      } else if (product.kind === 'BOOST') {
        if (!targetPropertyId) {
          throw new BadRequestException('Boost payment has no target property');
        }
        const latestCampaign = await tx.boostCampaign.findFirst({
          where: {
            propertyId: targetPropertyId,
            status: { in: ['ACTIVE', 'SCHEDULED'] },
            endsAt: { gt: paidAt },
          },
          orderBy: { endsAt: 'desc' },
        });
        const startsAt = latestCampaign?.endsAt ?? paidAt;
        const boostedUntil = new Date(
          startsAt.getTime() + product.durationDays! * 24 * 60 * 60 * 1_000,
        );
        const updated = await tx.property.updateMany({
          where: { id: targetPropertyId, ownerId: userId },
          data: { isBoosted: true, boostedUntil },
        });
        if (updated.count !== 1) {
          throw new NotFoundException('Boost target property not found');
        }
        await tx.boostCampaign.create({
          data: {
            propertyId: targetPropertyId,
            userId,
            paymentTransactionId: transaction.id,
            productSku: paymentType,
            durationDays: product.durationDays!,
            startsAt,
            endsAt: boostedUntil,
            status: startsAt <= paidAt ? 'ACTIVE' : 'SCHEDULED',
          },
        });
      }
      return true;
    });

    if (applied) {
      this.realtime.paymentUpdated(userId, {
        providerOrderId,
        status: 'SUCCESS',
        providerTransactionId: transactionId,
        paidAt: paidAt.toISOString(),
      });
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async reconcilePendingTransactions(): Promise<void> {
    await this.prismaService.property.updateMany({
      where: {
        isBoosted: true,
        boostedUntil: { lte: new Date() },
      },
      data: { isBoosted: false, boostedUntil: null },
    });

    const now = new Date();
    await this.prismaService.boostCampaign.updateMany({
      where: { status: { in: ['ACTIVE', 'SCHEDULED'] }, endsAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    await this.prismaService.boostCampaign.updateMany({
      where: {
        status: 'SCHEDULED',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      data: { status: 'ACTIVE' },
    });

    const pendingTransactions =
      await this.prismaService.paymentTransaction.findMany({
        where: {
          status: 'PENDING',
          createdAt: { lte: new Date(Date.now() - 30 * 60_000) },
        },
        take: 100,
        orderBy: { createdAt: 'asc' },
      });

    for (const transaction of pendingTransactions) {
      const { isSuccessful, transactionId } =
        await this.gateway.checkTransactionStatus(transaction.providerOrderId);
      if (isSuccessful && transactionId) {
        await this.processSuccessfulPayment(
          transaction.userId,
          transaction.paymentType,
          transactionId,
          transaction.providerOrderId,
        );
      }
    }
  }
}
