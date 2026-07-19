import { Module } from '@nestjs/common';
import { PrivateStorageModule } from '../storage/private-storage.module';
import { VerificationFilesPipe } from './pipes/verification-files.pipe';
import { VerificationDocumentUploadService } from './services/verification-document-upload.service';
import { IdentityImageValidator } from './validation/identity-image.validator';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [PrivateStorageModule],
  controllers: [VerificationController],
  providers: [
    VerificationService,
    IdentityImageValidator,
    VerificationFilesPipe,
    VerificationDocumentUploadService,
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
