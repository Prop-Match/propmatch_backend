import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExtractTenantRequestDto } from './extract-tenant-request.dto';

describe('ExtractTenantRequestDto', () => {
  it('trims valid text before extraction', async () => {
    const dto = plainToInstance(ExtractTenantRequestDto, {
      text: '  طلب شقة  ',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.text).toBe('طلب شقة');
  });

  it.each(['', '   '])('rejects empty text', async (text) => {
    const dto = plainToInstance(ExtractTenantRequestDto, { text });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('supports the global whitelist behavior for unknown fields', async () => {
    const dto = plainToInstance(ExtractTenantRequestDto, {
      text: 'طلب شقة',
      tenantId: 'must-not-be-accepted',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === 'tenantId')).toBe(true);
  });
});
