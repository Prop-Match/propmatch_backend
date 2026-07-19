import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { VerificationResponseDto } from './dto/verification-response.dto';
import { toVerificationResponse } from './mappers/verification-response.mapper';
import {
  UploadedVerificationDocumentKeys,
  VerificationDocumentUploadService,
} from './services/verification-document-upload.service';
import { ValidatedVerificationFiles } from './types/verification-upload-files.type';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentUploads: VerificationDocumentUploadService,
    private readonly realtime: RealtimeService,
  ) {}

  async getMyVerification(userId: string): Promise<VerificationResponseDto> {
    const verification = await this.prisma.identityVerification.findUnique({
      where: { userId },
      select: {
        status: true,
        rejectionReason: true,
        submittedAt: true,
        reviewedAt: true,
      },
    });

    return toVerificationResponse(verification);
  }

  async submit(
    userId: string,
    dto: SubmitVerificationDto,
    files: ValidatedVerificationFiles,
  ): Promise<VerificationResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        fullName: true,
        identityVerification: {
          select: {
            status: true,
            nationalIdFrontObjectKey: true,
            nationalIdBackObjectKey: true,
            selfieObjectKey: true,
          },
        },
      },
    });
    if (!user) throw new UnauthorizedException('تعذر إتمام طلب التحقق.');

    const existing = user.identityVerification;
    if (existing && existing.status !== 'RESUBMISSION_REQUIRED') {
      throw this.submissionConflict(existing.status);
    }

    const uploaded =
      await this.documentUploads.uploadVerificationDocuments(files);
    const submittedAt = new Date();
    try {
      if (!existing) {
        await this.prisma.identityVerification.create({
          data: {
            userId,
            nationalId: dto.nationalId ?? null,
            ...uploaded,
            status: 'PENDING',
            submittedAt,
            rejectionReason: null,
            reviewedAt: null,
            reviewedBy: null,
          },
        });
      } else {
        const update = await this.prisma.identityVerification.updateMany({
          where: { userId, status: 'RESUBMISSION_REQUIRED' },
          data: {
            ...uploaded,
            status: 'PENDING',
            submittedAt,
            rejectionReason: null,
            reviewedAt: null,
            reviewedBy: null,
            ...(dto.nationalId !== undefined
              ? { nationalId: dto.nationalId }
              : {}),
          },
        });
        if (update.count !== 1) {
          throw new ConflictException('تم إرسال طلب التحقق بالفعل.');
        }
      }
    } catch (error: unknown) {
      await this.documentUploads.deleteVerificationDocuments(uploaded);
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('تم إرسال طلب التحقق بالفعل.');
      }
      throw error;
    }

    if (existing) {
      await this.documentUploads.deleteVerificationDocuments(
        this.oldDocumentKeys(existing),
      );
    }
    this.announceSubmissionBestEffort(userId, user.fullName, submittedAt);
    return toVerificationResponse({
      status: 'PENDING',
      rejectionReason: null,
      submittedAt,
      reviewedAt: null,
    });
  }

  private submissionConflict(status: string): ConflictException {
    if (status === 'PENDING') {
      return new ConflictException('طلب التحقق قيد المراجعة بالفعل.');
    }
    if (status === 'APPROVED') {
      return new ConflictException('تم توثيق الهوية بالفعل.');
    }
    return new ConflictException(
      'لا يمكن إعادة إرسال طلب التحقق في حالته الحالية.',
    );
  }

  private oldDocumentKeys(existing: {
    nationalIdFrontObjectKey: string;
    nationalIdBackObjectKey: string;
    selfieObjectKey: string;
  }): UploadedVerificationDocumentKeys {
    return {
      nationalIdFrontObjectKey: existing.nationalIdFrontObjectKey,
      nationalIdBackObjectKey: existing.nationalIdBackObjectKey,
      selfieObjectKey: existing.selfieObjectKey,
    };
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  private announceSubmissionBestEffort(
    userId: string,
    userName: string,
    submittedAt: Date,
  ): void {
    try {
      this.realtime.kycSubmitted({ userId, userName, submittedAt });
    } catch {
      // Persistence remains the source of truth.
    }
  }
}
