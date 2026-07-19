import { Module } from '@nestjs/common';
import { TenantRequestsService } from './tenant-requests.service';
import { TenantRequestsController } from './tenant-requests.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [TenantRequestsController],
  providers: [TenantRequestsService],
})
export class TenantRequestsModule {}
