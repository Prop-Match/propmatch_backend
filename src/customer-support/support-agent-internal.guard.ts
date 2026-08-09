import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class SupportAgentInternalGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.config.get<string>('INTERNAL_SERVICE_API_KEY');
    if (!configured) {
      throw new ServiceUnavailableException(
        'Support-agent internal authentication is not configured.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const supplied = request.header('x-internal-service-key');
    if (!supplied || !sameSecret(supplied, configured)) {
      throw new UnauthorizedException('Invalid internal service key.');
    }
    if (!request.header('x-propmatch-user-id')) {
      throw new UnauthorizedException('Missing trusted support-agent user ID.');
    }
    return true;
  }
}

function sameSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
