import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  exports: [AdminService],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
