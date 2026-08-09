import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommercialConfigService } from './commercial-config.service';

describe('CommercialConfigService', () => {
  it('merges persisted values with immutable product semantics', async () => {
    const prisma = {
      productConfiguration: {
        findUnique: jest.fn().mockResolvedValue({
          priceEgp: 65,
          enabled: true,
          quantity: 14,
          validityDays: 75,
          durationDays: null,
        }),
      },
    } as unknown as PrismaService;

    const product = await new CommercialConfigService(prisma).getProduct(
      'OFFERS_10_60D',
    );

    expect(product).toMatchObject({
      paymentType: 'OFFERS_10_60D',
      kind: 'ENTITLEMENT',
      entitlementType: 'MATCHED_OFFER',
      priceEgp: 65,
      quantity: 14,
      validityDays: 75,
    });
  });

  it('prevents checkout when an admin disabled a product', async () => {
    const prisma = {
      productConfiguration: {
        findUnique: jest.fn().mockResolvedValue({
          priceEgp: 79,
          enabled: false,
          quantity: null,
          validityDays: null,
          durationDays: 7,
        }),
      },
    } as unknown as PrismaService;
    const service = new CommercialConfigService(prisma);

    await expect(service.checkoutSnapshot('BOOST_7D')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
