import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrivateStorageModule } from '../storage/private-storage.module';
import { PropertiesModule } from '../properties/properties.module';
import { MatchingModule } from '../matching/matching.module';
import { MailModule } from '../mail/mail.module';
import { CapabilitiesGuard } from './guards/capabilities.guard';

@Module({
  imports: [PrivateStorageModule, PropertiesModule, MatchingModule, MailModule],
  exports: [AdminService],
  providers: [AdminService, CapabilitiesGuard],
  controllers: [AdminController],
})
export class AdminModule {}
