import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrivateStorageModule } from '../storage/private-storage.module';
import { PropertiesModule } from '../properties/properties.module';

@Module({
  imports: [PrivateStorageModule, PropertiesModule],
  exports: [AdminService],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
