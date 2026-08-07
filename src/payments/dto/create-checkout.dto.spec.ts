import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCheckoutDto } from './create-checkout.dto';

describe('CreateCheckoutDto', () => {
  it('requires a wallet phone for mobile wallet checkout', async () => {
    const dto = plainToInstance(CreateCheckoutDto, {
      paymentType: 'SINGLE_OFFER',
      method: 'WALLET',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'walletPhone')).toBe(true);
  });

  it('accepts and compacts a valid Egyptian wallet phone', async () => {
    const dto = plainToInstance(CreateCheckoutDto, {
      paymentType: 'SINGLE_OFFER',
      method: 'WALLET',
      walletPhone: '010-1234-5678',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.walletPhone).toBe('01012345678');
  });

  it('does not require a wallet phone for card checkout', async () => {
    const dto = plainToInstance(CreateCheckoutDto, {
      paymentType: 'PREMIUM_OWNER',
      method: 'CARD',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});
