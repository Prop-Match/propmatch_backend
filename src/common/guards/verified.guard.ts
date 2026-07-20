import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Rejects requests from users whose identity verification is not APPROVED.
 *
 * Must be placed AFTER JwtAuthGuard (so `req.user` is populated).
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, RolesGuard, VerifiedGuard)
 */
@Injectable()
export class VerifiedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { userId: string } }>();

    const userId = request.user?.userId;
    if (!userId) return false;

    const verification = await this.prisma.identityVerification.findUnique({
      where: { userId },
    });

    if (!verification || verification.status !== 'APPROVED') {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'VERIFICATION_REQUIRED',
        message: 'وثّق هويتك أولًا لإتمام هذا الإجراء',
      });
    }

    return true;
  }
}
