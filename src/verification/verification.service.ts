import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { VerificationResponseDto } from './dto/verification-response.dto';
import { toVerificationResponse } from './mappers/verification-response.mapper';

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

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

  submit(_userId: string, _dto: SubmitVerificationDto): Promise<never> {
    void _userId;
    void _dto;
    return Promise.reject(
      new NotImplementedException('رفع مستندات التحقق غير متاح بعد.'),
    );
  }
}
