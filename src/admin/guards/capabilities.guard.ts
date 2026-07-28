import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { REQUIRE_CAPABILITY_KEY } from '../decorators/require-capability.decorator';
import { capabilitiesFor, type Capability } from '../capabilities';

/**
 * Enforces @RequireCapability. MUST run after JwtAuthGuard + RolesGuard (so
 * req.user is populated and the ADMIN role is already verified). Looks up the
 * caller's adminRole and 403s unless they hold one of the required capabilities.
 */
@Injectable()
export class CapabilitiesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Capability[]>(
      REQUIRE_CAPABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<{ user?: { userId?: string } }>();
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { adminRole: true },
    });
    const held = capabilitiesFor(user?.adminRole);
    const allowed = required.some((cap) => held.includes(cap));
    if (!allowed) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'FORBIDDEN_CAPABILITY',
        message: 'صلاحيات المشرف غير كافية لهذا الإجراء',
        requiredCapability: required,
      });
    }
    return true;
  }
}
