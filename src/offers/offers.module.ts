import { Module } from '@nestjs/common';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

/**
 * PRO-12/13 offers. RealtimeService (for notifying the tenant) and
 * PrismaService are both global, so nothing extra is imported here.
 */
@Module({
  controllers: [OffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
