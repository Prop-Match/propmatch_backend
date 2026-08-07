import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { TenantRequestBrowseGuard } from './tenant-request-browse.guard';

function context(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

describe('tenant request browse guards', () => {
  it('allows an unauthenticated guest through optional authentication', () => {
    const guard = new OptionalJwtAuthGuard();
    expect(guard.canActivate(context({ headers: {} }))).toBe(true);
  });

  it('allows guests and landlords to browse public tenant requests', () => {
    const guard = new TenantRequestBrowseGuard();
    expect(guard.canActivate(context({}))).toBe(true);
    expect(guard.canActivate(context({ user: { role: 'LANDLORD' } }))).toBe(
      true,
    );
  });

  it('denies authenticated tenants', () => {
    const guard = new TenantRequestBrowseGuard();
    expect(() =>
      guard.canActivate(context({ user: { role: 'TENANT' } })),
    ).toThrow(ForbiddenException);
  });
});
