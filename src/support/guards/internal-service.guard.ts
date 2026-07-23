import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Authenticates the external legal-support AI service calling back into us
 * for a human handoff. Reuses LEGAL_SUPPORT_INTERNAL_API_KEY as the shared
 * secret — it's already the trust anchor between these two services (see
 * legal-support.service.ts, which sends it as X-Internal-Service-Key on the
 * outbound leg); this guard checks the same header on the inbound leg.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedKey = this.config.get<string>(
      'LEGAL_SUPPORT_INTERNAL_API_KEY',
    );
    if (!expectedKey) {
      throw new ServiceUnavailableException(
        'Support handoff is not configured.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const providedKey = request.headers['x-internal-service-key'];
    if (providedKey !== expectedKey) {
      throw new UnauthorizedException('Invalid internal service key.');
    }
    return true;
  }
}
