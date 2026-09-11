import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@Request() req: { user: { userId: string } }) {
    return this.notificationsService.list(req.user.userId);
  }

  @Post('read-all')
  markAllRead(@Request() req: { user: { userId: string } }) {
    return this.notificationsService.markAllRead(req.user.userId);
  }

  @Post(':id/read')
  markRead(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.notificationsService.markRead(req.user.userId, id);
  }

  @Post('device-token')
  registerDeviceToken(
    @Request() req: { user: { userId: string } },
    @Body() body: { token: string; platform?: string },
  ) {
    return this.notificationsService.registerDeviceToken(
      req.user.userId,
      body.token,
      body.platform,
    );
  }

  @Post('device-token/remove')
  removeDeviceToken(@Body() body: { token: string }) {
    return this.notificationsService.removeDeviceToken(body.token);
  }
}
