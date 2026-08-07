import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { ChatUploadStorageService } from './chat-upload-storage.service';

@Module({
  controllers: [UploadsController],
  providers: [ChatUploadStorageService],
  exports: [ChatUploadStorageService],
})
export class UploadsModule {}
