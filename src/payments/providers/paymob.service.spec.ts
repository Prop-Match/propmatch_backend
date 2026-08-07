import { HttpService } from '@nestjs/axios';
import { BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymobService } from './paymob.service';

describe('PaymobService wallet checkout', () => {
  const originalEnv = process.env;
  const user = {
    id: 'user-id',
    fullName: 'Wallet Customer',
    email: 'wallet@example.com',
    phoneNumber: '01111111111',
  };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      PAYMOB_SECRET_KEY: '',
      PAYMOB_PUBLIC_KEY: '',
      PAYMOB_API_KEY: 'api-key',
      PAYMOB_INTEGRATION_ID: '1001',
      PAYMOB_INTEGRATION_ID_CARD: '1001',
      PAYMOB_IFRAME_ID: 'card-iframe',
      PAYMOB_WALLET_INTEGRATION_ID: '2002',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function setup(walletResponse: Record<string, unknown>) {
    const post = jest
      .fn()
      .mockReturnValueOnce(of({ data: { token: 'auth-token' } }))
      .mockReturnValueOnce(of({ data: { id: 12345 } }))
      .mockReturnValueOnce(of({ data: { token: 'payment-token' } }))
      .mockReturnValueOnce(of({ data: walletResponse }));
    const http = { post } as unknown as HttpService;
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user) },
    } as unknown as PrismaService;

    return { service: new PaymobService(http, prisma), post };
  }

  it('uses the checkout phone instead of the profile phone', async () => {
    const { service, post } = setup({
      redirect_url: 'https://wallet.example/authorize',
    });

    const checkout = await service.generatePaymentUrl(
      user.id,
      'SINGLE_OFFER',
      99,
      'WALLET',
      '+201012345678',
    );

    expect(checkout).toEqual({
      providerOrderId: '12345',
      checkoutUrl: 'https://wallet.example/authorize',
    });
    expect(post).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('/api/acceptance/payments/pay'),
      {
        payment_token: 'payment-token',
        source: { identifier: '01012345678', subtype: 'WALLET' },
      },
    );
  });

  it('rejects a wallet response without a redirect instead of using the card iframe', async () => {
    const { service, post } = setup({
      redirect_url: '',
      data: { message: 'Receiver is not registered' },
    });

    await expect(
      service.generatePaymentUrl(
        user.id,
        'SINGLE_OFFER',
        99,
        'WALLET',
        '01012345678',
      ),
    ).rejects.toThrow(
      'رقم الهاتف غير مسجل كمحفظة إلكترونية. في وضع الاختبار استخدم رقم محفظة Paymob التجريبي 01010101010.',
    );
    expect(post).toHaveBeenCalledTimes(4);
  });

  it('accepts Paymob wallet iframe redirection URLs', async () => {
    const { service } = setup({
      iframe_redirection_url: 'https://wallet.example/iframe-authorize',
    });

    await expect(
      service.generatePaymentUrl(
        user.id,
        'SINGLE_OFFER',
        99,
        'WALLET',
        '01012345678',
      ),
    ).resolves.toEqual({
      providerOrderId: '12345',
      checkoutUrl: 'https://wallet.example/iframe-authorize',
    });
  });

  it('builds a card checkout URL with the configured card iframe', async () => {
    const { service, post } = setup({});

    await expect(
      service.generatePaymentUrl(user.id, 'AI_ADDON', 199, 'CARD'),
    ).resolves.toEqual({
      providerOrderId: '12345',
      checkoutUrl:
        'https://accept.paymob.com/api/acceptance/iframes/card-iframe?payment_token=payment-token',
    });
    expect(post).toHaveBeenCalledTimes(3);
    expect(post).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('/api/acceptance/payment_keys'),
      expect.objectContaining({ integration_id: 1001 }),
    );
  });

  it('returns a safe customer message when the card iframe is missing', async () => {
    delete process.env.PAYMOB_IFRAME_ID;
    const { service } = setup({});

    await expect(
      service.generatePaymentUrl(user.id, 'AI_ADDON', 199, 'CARD'),
    ).rejects.toThrow(
      'خدمة الدفع بالبطاقات غير متاحة حالياً. حاول مرة أخرى لاحقاً.',
    );
  });

  it('rejects wallet checkout when its integration ID is missing', async () => {
    delete process.env.PAYMOB_WALLET_INTEGRATION_ID;
    delete process.env.PAYMOB_INTEGRATION_ID_WALLET;
    const { service, post } = setup({});

    await expect(
      service.generatePaymentUrl(
        user.id,
        'SINGLE_OFFER',
        99,
        'WALLET',
        '01012345678',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(post).not.toHaveBeenCalled();
  });
});
