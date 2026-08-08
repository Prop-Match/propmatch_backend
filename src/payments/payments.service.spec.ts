import { PrismaService } from '../../prisma/prisma.service';
import type { PaymentUpdatedPayload } from '../realtime/realtime.contract';
import { RealtimeService } from '../realtime/realtime.service';
import { PaymentsService } from './payments.service';
import { PaymobService } from './providers/paymob.service';

describe('PaymentsService settlement', () => {
  it('applies entitlement and emits once for duplicate successful callbacks', async () => {
    const payment = {
      id: 'payment-id',
      userId: 'user-id',
      providerOrderId: '12345',
      providerTransactionId: null,
      paymentType: 'AI_ADDON',
      targetPropertyId: null,
      status: 'PENDING',
    };
    const upsertQuota = jest.fn().mockResolvedValue({});
    const transactionClient = {
      paymentTransaction: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(payment),
      },
      userQuota: {
        upsert: upsertQuota,
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
    const service = new PaymentsService(prisma, gateway, realtime);

    await service.handleWebhook({}, {});
    await service.handleWebhook({}, {});

    expect(upsertQuota).toHaveBeenCalledTimes(1);
    expect(paymentUpdated).toHaveBeenCalledTimes(1);
    expect(emittedUserId).toBe('user-id');
    expect(emittedPayment).toMatchObject({
      providerOrderId: '12345',
      status: 'SUCCESS',
      providerTransactionId: 'transaction-1',
    });
    expect(typeof emittedPayment?.paidAt).toBe('string');
  });
});
