import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatUploadStorageService } from './chat-upload-storage.service';

// Hard multer cap at the larger limit; the service applies the per-type cap.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Shared chat attachment upload. Any authenticated user uploads a single
 * image / video / voice-note file and receives a served URL to attach to a
 * match message or a support message.
 */
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly storage: ChatUploadStorageService) {}

  @Post('chat')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async uploadChatAttachment(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('لم يتم إرفاق ملف');
    return this.storage.store(file);
  }
}
