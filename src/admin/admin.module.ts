import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrivateStorageModule } from '../storage/private-storage.module';

@Module({
  imports: [PrivateStorageModule],
  exports: [AdminService],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
