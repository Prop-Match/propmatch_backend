import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from 'generated/prisma/client';

@Injectable()
export class TenantRequestBrowseGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role: UserRole } }>();

    if (request.user?.role === 'TENANT') {
      throw new ForbiddenException(
        'طلبات المستأجرين متاحة للضيوف والملاك فقط.',
      );
    }

    return true;
  }
}
