import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * PRO-06 — notification bell REST API (Ali).
 *
 * Routes (all under the /api global prefix, JWT-guarded):
 *   GET  /api/notifications            -> { items, unread }
 *   POST /api/notifications/read-all   -> { ok: true }
 *   POST /api/notifications/:id/read   -> { ok: true }
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@Request() req: { user: { userId: string } }) {
    return this.notificationsService.list(req.user.userId);
  }

  // Declared before `:id/read` so the literal path is never shadowed by the param.
  @Post('read-all')
  @HttpCode(200)
  markAllRead(@Request() req: { user: { userId: string } }) {
    return this.notificationsService.markAllRead(req.user.userId);
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.notificationsService.markRead(req.user.userId, id);
  }
}
