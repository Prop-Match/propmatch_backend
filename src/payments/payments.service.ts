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
  BOOST_DURATION_DAYS,
  type BillablePaymentType,
  isBillablePaymentType,
  PREMIUM_ACTIVE_LISTING_LIMIT,
  OWNER_PLUS_ACTIVE_LISTING_LIMIT,
  PREMIUM_INCLUDED_AI_USES,
  OWNER_PLUS_INCLUDED_AI_USES,
  AI_ADDON_USES,
  PRICING_CATALOG,
} from './pricing.catalog';
import { PaymobService } from './providers/paymob.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly gateway: PaymobService,
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

    const product = PRICING_CATALOG[dto.paymentType];
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || !product.allowedRoles.some((role) => role === user.role)) {
      throw new ForbiddenException(
        'This product is not available to this role',
      );
    }

    if (dto.paymentType === 'BOOST_LISTING') {
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
      );

    await this.prismaService.paymentTransaction.create({
      data: {
        userId,
        providerOrderId,
        amount: product.priceEgp,
        paymentType: dto.paymentType,
        targetPropertyId: dto.propertyId,
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

    if (result.providerOrderId) {
      const transaction =
        await this.prismaService.paymentTransaction.findUnique({
          where: { providerOrderId: result.providerOrderId },
        });
      if (transaction) {
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
      await this.prismaService.paymentTransaction.updateMany({
        where: { providerOrderId: result.providerOrderId, status: 'PENDING' },
        data: {
          status: 'FAILED',
          providerTransactionId: result.transactionId,
        },
      });
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

  async reconcileTransaction(userId: string, providerOrderId: string) {
    const transaction = await this.getTransaction(userId, providerOrderId);
    if (transaction.status === 'SUCCESS') {
      return transaction;
    }

    const { isSuccessful, transactionId } =
      await this.gateway.checkTransactionStatus(providerOrderId);
    if (isSuccessful && transactionId) {
      await this.processSuccessfulPayment(
        transaction.userId,
        transaction.paymentType,
        transactionId,
        providerOrderId,
      );
    }
    return this.getTransaction(userId, providerOrderId);
  }

  async reconcilePendingForUser(userId: string) {
    const pendingTransactions =
      await this.prismaService.paymentTransaction.findMany({
        where: { userId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
    return Promise.all(
      pendingTransactions.map((transaction) =>
        this.reconcileTransaction(userId, transaction.providerOrderId),
      ),
    );
  }

  private async processSuccessfulPayment(
    userId: string,
    paymentType: string,
    transactionId: string,
    providerOrderId?: string,
  ): Promise<void> {
    const existing = await this.prismaService.paymentTransaction.findFirst({
      where: { providerTransactionId: transactionId },
    });
    if (existing) return;

    await this.prismaService.$transaction(async (tx) => {
      let targetPropertyId: string | null = null;
      if (providerOrderId) {
        const transaction = await tx.paymentTransaction.update({
          where: { providerOrderId },
          data: {
            status: 'SUCCESS',
            providerTransactionId: transactionId,
            paidAt: new Date(),
          },
        });
        targetPropertyId = transaction.targetPropertyId;
      } else {
        const transaction = await tx.paymentTransaction.findFirst({
          where: { userId, status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
        });
        if (!transaction) {
          throw new NotFoundException('Pending payment transaction not found');
        }
        targetPropertyId = transaction.targetPropertyId;
        await tx.paymentTransaction.update({
          where: { id: transaction.id },
          data: {
            status: 'SUCCESS',
            providerTransactionId: transactionId,
            paidAt: new Date(),
          },
        });
      }

      if (!isBillablePaymentType(paymentType)) {
        this.logger.warn(
          `No entitlement granted for legacy payment: ${paymentType}`,
        );
        return;
      }

      if (paymentType === 'PREMIUM_OWNER') {
        const current = await tx.userQuota.findUnique({ where: { userId } });
        const startsAt =
          current?.planExpiresAt && current.planExpiresAt.getTime() > Date.now()
            ? current.planExpiresAt
            : new Date();
        const planExpiresAt = new Date(startsAt);
        planExpiresAt.setMonth(planExpiresAt.getMonth() + 1);
        const optimizerUsesLeft = Math.max(
          current?.optimizerUsesLeft ?? 0,
          PREMIUM_INCLUDED_AI_USES,
        );

        await tx.userQuota.upsert({
          where: { userId },
          create: {
            userId,
            planType: 'PREMIUM',
            planExpiresAt,
            maxActiveListings: PREMIUM_ACTIVE_LISTING_LIMIT,
            optimizerUsesLeft,
            freeOffersLeft: 3,
          },
          update: {
            planType: 'PREMIUM',
            planExpiresAt,
            maxActiveListings: PREMIUM_ACTIVE_LISTING_LIMIT,
            optimizerUsesLeft,
          },
        });
      } else if (paymentType === 'OWNER_PLUS') {
        const current = await tx.userQuota.findUnique({ where: { userId } });
        const startsAt =
          current?.planExpiresAt && current.planExpiresAt.getTime() > Date.now()
            ? current.planExpiresAt
            : new Date();
        const planExpiresAt = new Date(startsAt);
        planExpiresAt.setMonth(planExpiresAt.getMonth() + 1);
        const optimizerUsesLeft = Math.max(
          current?.optimizerUsesLeft ?? 0,
          OWNER_PLUS_INCLUDED_AI_USES,
        );

        await tx.userQuota.upsert({
          where: { userId },
          create: {
            userId,
            planType: 'OWNER_PLUS',
            planExpiresAt,
            maxActiveListings: OWNER_PLUS_ACTIVE_LISTING_LIMIT,
            optimizerUsesLeft,
            freeOffersLeft: 3,
          },
          update: {
            planType: 'OWNER_PLUS',
            planExpiresAt,
            maxActiveListings: OWNER_PLUS_ACTIVE_LISTING_LIMIT,
            optimizerUsesLeft,
          },
        });
      } else if (paymentType === 'SINGLE_LISTING') {
        await tx.userQuota.upsert({
          where: { userId },
          create: { userId, freeListingsLeft: 1, maxActiveListings: 2 },
          update: {
            freeListingsLeft: { increment: 1 },
            maxActiveListings: { increment: 1 },
          },
        });
      } else if (paymentType === 'SINGLE_OFFER') {
        await tx.userQuota.upsert({
          where: { userId },
          create: { userId, freeOffersLeft: 1 },
          update: {
            freeOffersLeft: { increment: 1 },
          },
        });
      } else if (paymentType === 'BOOST_LISTING') {
        if (!targetPropertyId) {
          throw new BadRequestException('Boost payment has no target property');
        }
        const boostedUntil = new Date();
        boostedUntil.setDate(boostedUntil.getDate() + BOOST_DURATION_DAYS);
        const updated = await tx.property.updateMany({
          where: { id: targetPropertyId, ownerId: userId },
          data: { isBoosted: true, boostedUntil },
        });
        if (updated.count !== 1) {
          throw new NotFoundException('Boost target property not found');
        }
      } else if (paymentType === 'AI_ADDON') {
        await tx.userQuota.upsert({
          where: { userId },
          create: { userId, optimizerUsesLeft: AI_ADDON_USES },
          update: { optimizerUsesLeft: { increment: AI_ADDON_USES } },
        });
      }
    });
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

    const pendingTransactions =
      await this.prismaService.paymentTransaction.findMany({
        where: {
          status: 'PENDING',
          createdAt: { lte: new Date(Date.now() - 30 * 60_000) },
        },
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
