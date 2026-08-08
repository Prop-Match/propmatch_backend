import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { PropertiesModule } from '../properties/properties.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
@Module({
  imports: [UploadsModule, PropertiesModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
