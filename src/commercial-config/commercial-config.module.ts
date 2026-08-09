import { Global, Module } from '@nestjs/common';
import { CapabilitiesGuard } from '../admin/guards/capabilities.guard';
import {
  AdminCommercialConfigController,
  CommercialCatalogController,
} from './commercial-config.controller';
import { CommercialConfigService } from './commercial-config.service';

@Global()
@Module({
  controllers: [CommercialCatalogController, AdminCommercialConfigController],
  providers: [CommercialConfigService, CapabilitiesGuard],
  exports: [CommercialConfigService],
})
export class CommercialConfigModule {}
