import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { VerificationFilesPipe } from './pipes/verification-files.pipe';
import type { ValidatedVerificationFiles } from './types/verification-upload-files.type';
import { MAX_IDENTITY_IMAGE_SIZE } from './validation/identity-image.validator';
import { VerificationService } from './verification.service';

type AuthenticatedRequest = { user: { userId: string } };

@Controller('verification')
@UseGuards(JwtAuthGuard)
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Get('me')
  getMyVerification(@Request() req: AuthenticatedRequest) {
    return this.verificationService.getMyVerification(req.user.userId);
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'nationalIdFront', maxCount: 1 },
        { name: 'nationalIdBack', maxCount: 1 },
        { name: 'selfie', maxCount: 1 },
      ],
      {
        limits: {
          fileSize: MAX_IDENTITY_IMAGE_SIZE,
          files: 3,
        },
      },
    ),
  )
  submit(
    @Request() req: AuthenticatedRequest,
    @Body() dto: SubmitVerificationDto,
    @UploadedFiles(VerificationFilesPipe)
    files: ValidatedVerificationFiles,
  ) {
    return this.verificationService.submit(req.user.userId, dto, files);
  }
}
