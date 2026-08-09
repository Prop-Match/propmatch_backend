import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from 'prisma/prisma.service';
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

  // Runs on every authenticated request. Besides the token being valid, the
  // account must be active and not suspended — so disabling or suspending a
  // user takes effect immediately, not only after the 1h access token expires.
  // A fast PK lookup of just those fields.
  async validate(payload: { sub: string; email: string; role: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
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
