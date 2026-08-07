import { TenantRequestsController } from './tenant-requests.controller';
import { TenantRequestsService } from './tenant-requests.service';
import { TenantRequestExtractionService } from './tenant-request-extraction.service';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { VerifiedGuard } from '../common/guards/verified.guard';

describe('TenantRequestsController extraction', () => {
  const extract = jest.fn();
  const controller = new TenantRequestsController(
    {} as TenantRequestsService,
    { extract } as unknown as TenantRequestExtractionService,
  );

  it('delegates only the validated tenant text to the extraction service', async () => {
    extract.mockResolvedValue({
      originalText: 'request',
      suggestions: {},
      missingFields: [],
    });

    await expect(controller.extract({ text: 'request' })).resolves.toEqual({
      originalText: 'request',
      suggestions: {},
      missingFields: [],
    });
    expect(extract).toHaveBeenCalledWith('request');
  });

  it('declares the existing tenant and verification guards for extraction', () => {
    expect(Reflect.getMetadata(ROLES_KEY, controller.extract)).toEqual([
      'TENANT',
    ]);
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      controller.extract,
    ) as unknown[];
    expect(guards).toContain(VerifiedGuard);
  });
});
