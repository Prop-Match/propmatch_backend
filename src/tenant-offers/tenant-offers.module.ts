import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { TenantOffersController } from './tenant-offers.controller';
import { TenantOffersService } from './tenant-offers.service';

@Module({
  imports: [CommonModule],
  controllers: [TenantOffersController],
  providers: [TenantOffersService],
})
export class TenantOffersModule {}
