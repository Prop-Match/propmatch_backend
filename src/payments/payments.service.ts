import { PaymentType } from '@generated/prisma/enums';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './../../prisma/prisma.service';
import { PaymobService } from './providers/paymob.service';

const PAYMENT_AMOUNTS: Record<PaymentType, number> = {
  NEW_LISTING: 100,
  BOOST_LISTING: 75,
  REFILL_MATCHES: 30,
  OFFER_PACK: 50,
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  constructor(
    private readonly prismaService: PrismaService,
    private readonly gatway: PaymobService,
  ) {}
  async checkout(
    userId: string,
    paymentType: string,
  ): Promise<{
    paymobOrderId: string;
    amount: number;
    currency: 'EGP';
    paymentType: PaymentType;
    iframeUrl: string;
  }> {
    const typedPaymentType = paymentType as PaymentType;
    const amount = PAYMENT_AMOUNTS[typedPaymentType];
    if (!amount) {
      throw new BadRequestException('Unsupported payment type');
    }

    const { checkoutUrl, providerOrderId } =
      await this.gatway.generatePaymentUrl(userId, typedPaymentType, amount);

    await this.prismaService.paymentTransaction.create({
      data: {
        userId,
        paymobOrderId: providerOrderId,
        amount: amount,
        paymentType: typedPaymentType,
        status: 'PENDING',
      },
    });

    return {
      paymobOrderId: providerOrderId,
      amount,
      currency: 'EGP',
      paymentType: typedPaymentType,
      iframeUrl: checkoutUrl,
    };
  }
  async handleWebhook(
    query: Record<string, string>,
    body: Record<string, unknown>,
  ): Promise<{ recieved: boolean }> {
    const result = this.gatway.processWebhook(query, body);
    if (!result.isValid) {
      throw new BadRequestException('Invalid signature');
    }

    let userId = result.userId;
    let paymentType = result.paymentType;

    if ((!userId || !paymentType) && result.providerOrderId) {
      const transaction =
        await this.prismaService.paymentTransaction.findUnique({
          where: { paymobOrderId: result.providerOrderId },
        });
      if (transaction) {
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
    }
    return { recieved: true };
  }

  async getTransaction(userId: string, paymobOrderId: string) {
    const transaction = await this.prismaService.paymentTransaction.findFirst({
      where: { userId, paymobOrderId },
    });
    if (!transaction) {
      throw new NotFoundException('Payment transaction not found');
    }
    return transaction;
  }

  /**
   * Return-page fallback for local development and a safety net for delayed
   * webhooks. The entitlement is still awarded only after Paymob's server API
   * confirms the order as successful.
   */
  async reconcileTransaction(userId: string, paymobOrderId: string) {
    const transaction = await this.getTransaction(userId, paymobOrderId);
    if (transaction.status === 'SUCCESS') {
      return transaction;
    }

    const { isSuccessful, transactionId } =
      await this.gatway.checkTransactionStatus(paymobOrderId);
    if (isSuccessful && transactionId) {
      await this.processSuccessfulPayment(
        transaction.userId,
        transaction.paymentType,
        transactionId,
        paymobOrderId,
      );
    }
    return this.getTransaction(userId, paymobOrderId);
  }

  async reconcilePendingForUser(userId: string) {
    const pendingTransactions =
      await this.prismaService.paymentTransaction.findMany({
        where: { userId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
    return Promise.all(
      pendingTransactions.map((transaction) =>
        this.reconcileTransaction(userId, transaction.paymobOrderId),
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
      where: { paymobTransactionId: transactionId },
    });
    if (existing) {
      return;
    }

    await this.prismaService.$transaction(async (tx) => {
      if (providerOrderId) {
        await tx.paymentTransaction.update({
          where: { paymobOrderId: providerOrderId },
          data: {
            status: 'SUCCESS',
            paymobTransactionId: transactionId,
            paidAt: new Date(),
          },
        });
      } else {
        await tx.paymentTransaction.updateMany({
          where: { userId, status: 'PENDING' },
          data: {
            status: 'SUCCESS',
            paymobTransactionId: transactionId,
            paidAt: new Date(),
          },
        });
      }
      const quota = await tx.userQuota.findUnique({
        where: { userId },
      });

      if (paymentType === 'NEW_LISTING') {
        if (quota) {
          await tx.userQuota.update({
            where: { userId },
            data: { freeListingsLeft: { increment: 1 } },
          });
        } else {
          await tx.userQuota.create({
            data: {
              userId,
              freeListingsLeft: 2, // 1 default + 1 purchased
              freeOffersLeft: 3,
              optimizerUsesLeft: 2,
            },
          });
        }
      } else if (paymentType === 'OFFER_PACK') {
        if (quota) {
          await tx.userQuota.update({
            where: { userId },
            data: { freeOffersLeft: { increment: 1 } },
          });
        } else {
          await tx.userQuota.create({
            data: {
              userId,
              freeListingsLeft: 1,
              freeOffersLeft: 4, // 3 default + 1 purchased
              optimizerUsesLeft: 2,
            },
          });
        }
      }
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async reconcilePendingTransactions(): Promise<void> {
    this.logger.log('Starting Payment Reconciliation Cron Job...');

    // Find all transactions that are PENDING and older than 30 minutes
    const pendingTransactions =
      await this.prismaService.paymentTransaction.findMany({
        where: {
          status: 'PENDING',
          createdAt: { lte: new Date(Date.now() - 30 * 60000) },
        },
      });
    for (const transaction of pendingTransactions) {
      // Ask the gateway (Paymob, Stripe, etc.) to double-check the real status
      const { isSuccessful, transactionId } =
        await this.gatway.checkTransactionStatus(transaction.paymobOrderId);
      if (isSuccessful && transactionId) {
        this.logger.log(
          `Reconciliation found missed successful payment for Order: ${transaction.paymobOrderId}`,
        );
        await this.processSuccessfulPayment(
          transaction.userId,
          transaction.paymentType,
          transactionId,
          transaction.paymobOrderId,
        );
      }
    }

    this.logger.log('Payment Reconciliation complete.');
  }
}
