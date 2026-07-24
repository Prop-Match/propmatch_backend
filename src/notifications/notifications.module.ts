import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * PRO-06 — notification bell REST endpoints. PrismaService is global, so no
 * imports are needed; the push side lives in RealtimeModule.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
