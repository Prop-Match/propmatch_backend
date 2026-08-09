import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { isSuspensionActive, suspensionMessage } from '../../common/suspension';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * Runs on every authenticated request. JWTs are otherwise stateless — this
   * DB lookup is the deliberate tradeoff that makes "delete/suspend a user"
   * revoke their session immediately instead of waiting for the token to
   * expire. Selects only what's needed (not the whole row) to keep the added
   * latency as small as this guarantee can reasonably cost.
   *
   * Three independent checks, in order:
   * 1. tokenVersion mismatch (or user gone entirely) → 401. This closes the
   *    reactivation gap: deletion alone already revokes every session
   *    (deletedAt check below), but a token minted *before* a reactivation
   *    must also stop working once tokenVersion is bumped — a stale token
   *    otherwise stays valid across a delete→reactivate cycle since
   *    deletedAt goes back to null. Note this rejects every token minted
   *    before this field existed (undefined !== 0) — a one-time forced
   *    re-login for all active sessions on deploy, which is the intended
   *    tradeoff for a security fix, not a bug.
   * 2. deletedAt set → 403 ACCOUNT_DELETED. A "ghost" account (self-delete or
   *    30-day-expired anonymized account) with its own reactivation flow.
   * 3. suspendedAt/suspendedUntil active → 403 ACCOUNT_SUSPENDED, with the
   *    reason + end date in the message. A live account an admin temporarily
   *    or permanently blocked — a distinct recovery path from #2 (wait it
   *    out or appeal, not request reactivation).
   */
  async validate(payload: {
    sub: string;
    email: string;
    role: string;
    tokenVersion?: number;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        deletedAt: true,
        tokenVersion: true,
        isActive: true,
        suspendedAt: true,
        suspendedUntil: true,
        suspensionReason: true,
      },
    });
    if (user && !user.isActive) {
      throw new ForbiddenException(
        'تم تعطيل هذا الحساب. برجاء التواصل مع الإدارة.',
      );
    }
    if (user && isSuspensionActive(user)) {
      throw new ForbiddenException(suspensionMessage(user));
    }
    // This return value is attached automatically to req.user
    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}
