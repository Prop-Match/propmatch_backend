import { Global, Module } from '@nestjs/common';
import { PropertyAnalyticsController } from './property-analytics.controller';
import { PropertyAnalyticsService } from './property-analytics.service';

@Global()
@Module({
  controllers: [PropertyAnalyticsController],
  providers: [PropertyAnalyticsService],
  exports: [PropertyAnalyticsService],
})
export class PropertyAnalyticsModule {}
