import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';

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
   * DB lookup is the deliberate tradeoff that makes "delete a user" revoke
   * their session immediately instead of waiting for the token to expire.
   * Selects only what's needed (not the whole row) to keep the added latency
   * as small as this guarantee can reasonably cost.
   */
  async validate(payload: { sub: string; email: string; role: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException();
    }
    // This return value is attached automatically to req.user
    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}
