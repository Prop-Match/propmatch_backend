import { PrismaService } from '../../prisma/prisma.service';
import type { PaymentUpdatedPayload } from '../realtime/realtime.contract';
import { RealtimeService } from '../realtime/realtime.service';
import { PaymentsService } from './payments.service';
import { PaymobService } from './providers/paymob.service';
import { CommercialConfigService } from '../commercial-config/commercial-config.service';

describe('PaymentsService settlement', () => {
  it('applies entitlement and emits once for duplicate successful callbacks', async () => {
    const payment = {
      id: 'payment-id',
      userId: 'user-id',
      providerOrderId: '12345',
      providerTransactionId: null,
      paymentType: 'AI_USES_10_90D',
      targetPropertyId: null,
      amount: 39,
      currency: 'EGP',
      catalogSnapshot: null,
      status: 'PENDING',
    };
    const createGrant = jest.fn().mockResolvedValue({});
    const transactionClient = {
      paymentTransaction: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(payment),
      },
      entitlementGrant: {
        create: createGrant,
      },
    };
    const prisma = {
      paymentTransaction: {
        findUnique: jest.fn().mockResolvedValue(payment),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        Promise.resolve(callback(transactionClient)),
      ),
    } as unknown as PrismaService;
    const gateway = {
      processWebhook: jest.fn().mockReturnValue({
        isValid: true,
        success: true,
        isFinal: true,
        transactionId: 'transaction-1',
        providerOrderId: payment.providerOrderId,
        amountCents: 3900,
        currency: 'EGP',
      }),
    } as unknown as PaymobService;
    let emittedUserId: string | undefined;
    let emittedPayment: PaymentUpdatedPayload | undefined;
    const paymentUpdated = jest.fn(
      (userId: string, payload: PaymentUpdatedPayload) => {
        emittedUserId = userId;
        emittedPayment = payload;
      },
    );
    const realtime = {
      paymentUpdated,
    } as unknown as RealtimeService;
    const commercialConfig = {
      parseSnapshot: jest.fn().mockReturnValue(null),
      getProduct: jest.fn().mockResolvedValue({
        paymentType: 'AI_USES_10_90D',
        priceEgp: 39,
        enabled: true,
        billing: 'ONE_TIME',
        kind: 'ENTITLEMENT',
        entitlementType: 'AI_OPTIMIZER_USE',
        quantity: 10,
        validityDays: 90,
      }),
    } as unknown as CommercialConfigService;
    const service = new PaymentsService(
      prisma,
      gateway,
      realtime,
      commercialConfig,
    );

    await service.handleWebhook({}, {});
    await service.handleWebhook({}, {});

    expect(createGrant).toHaveBeenCalledTimes(1);
    expect(createGrant).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        paymentTransactionId: 'payment-id',
        type: 'AI_OPTIMIZER_USE',
        grantedQuantity: 10,
        remainingQuantity: 10,
      }),
    });
    expect(paymentUpdated).toHaveBeenCalledTimes(1);
    expect(emittedUserId).toBe('user-id');
    expect(emittedPayment).toMatchObject({
      providerOrderId: '12345',
      status: 'SUCCESS',
      providerTransactionId: 'transaction-1',
    });
    expect(typeof emittedPayment?.paidAt).toBe('string');
  });

  it('does not grant entitlements when the paid amount differs from the stored transaction', async () => {
    const payment = {
      id: 'payment-id',
      userId: 'user-id',
      providerOrderId: '12345',
      providerTransactionId: null,
      paymentType: 'AI_USES_10_90D',
      targetPropertyId: null,
      amount: 39,
      currency: 'EGP',
      catalogSnapshot: null,
      status: 'PENDING',
    };
    const createGrant = jest.fn();
    const transactionClient = {
      paymentTransaction: {
        findUnique: jest.fn().mockResolvedValue(payment),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      entitlementGrant: {
        create: createGrant,
      },
    };
    const prisma = {
      paymentTransaction: {
        findUnique: jest.fn().mockResolvedValue(payment),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        Promise.resolve(callback(transactionClient)),
      ),
    } as unknown as PrismaService;
    const gateway = {
      processWebhook: jest.fn().mockReturnValue({
        isValid: true,
        success: true,
        isFinal: true,
        transactionId: 'transaction-1',
        providerOrderId: payment.providerOrderId,
        amountCents: 100,
        currency: 'EGP',
      }),
    } as unknown as PaymobService;
    const realtime = {
      paymentUpdated: jest.fn(),
    } as unknown as RealtimeService;
    const commercialConfig = {
      parseSnapshot: jest.fn(),
      getProduct: jest.fn(),
    } as unknown as CommercialConfigService;
    const service = new PaymentsService(
      prisma,
      gateway,
      realtime,
      commercialConfig,
    );

    await service.handleWebhook({}, {});

    expect(createGrant).not.toHaveBeenCalled();
    expect(realtime.paymentUpdated).not.toHaveBeenCalled();
    expect(transactionClient.paymentTransaction.updateMany).toHaveBeenCalledWith(
      {
        where: { providerOrderId: '12345', status: 'PENDING' },
        data: {
          status: 'FAILED',
          providerTransactionId: 'transaction-1',
        },
      },
    );
  });
});
