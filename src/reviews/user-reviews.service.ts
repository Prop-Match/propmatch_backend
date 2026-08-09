import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { UserReviewDirection } from '@generated/prisma/enums';
import type { UserReview } from '@generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateUserReviewDto } from './dto/create-user-review.dto';

@Injectable()
export class UserReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async statusForContract(userId: string, contractId: string) {
    const context = await this.contractContext(userId, contractId);
    const review = await this.prisma.userReview.findUnique({
      where: {
        leaseContractId_reviewerId: {
          leaseContractId: contractId,
          reviewerId: userId,
        },
      },
    });

    return {
      eligible: context.contractStatus === 'APPROVED',
      submitted: Boolean(review),
      direction: context.direction,
      revieweeId: context.revieweeId,
      revieweeName: context.revieweeName,
      review: review ? this.toReview(review) : null,
      receivedSummary: await this.summary(context.revieweeId),
    };
  }

  async create(userId: string, contractId: string, dto: CreateUserReviewDto) {
    const context = await this.contractContext(userId, contractId);
    if (context.contractStatus !== 'APPROVED') {
      throw new ConflictException('USER_REVIEW_REQUIRES_APPROVED_CONTRACT');
    }
    this.validateDirection(context.direction, dto);

    const existing = await this.prisma.userReview.findUnique({
      where: {
        leaseContractId_reviewerId: {
          leaseContractId: contractId,
          reviewerId: userId,
        },
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException('USER_REVIEW_ALREADY_SUBMITTED');

    let review: UserReview;
    try {
      review = await this.prisma.userReview.create({
        data: {
          leaseContractId: contractId,
          reviewerId: userId,
          revieweeId: context.revieweeId,
          direction: context.direction,
          overallRating: dto.overallRating,
          communicationRating: dto.communicationRating,
          responsivenessRating: dto.responsivenessRating,
          propertyAccuracyRating: dto.propertyAccuracyRating ?? null,
          commitmentRating: dto.commitmentRating ?? null,
        },
      });
    } catch (error: unknown) {
      if (this.errorCode(error) === 'P2002') {
        throw new ConflictException('USER_REVIEW_ALREADY_SUBMITTED');
      }
      throw error;
    }

    await this.realtime.notifyUser(context.revieweeId, {
      type: 'USER_REVIEW_RECEIVED',
      title: 'لديك تقييم جديد',
      message: 'أضاف الطرف الآخر تقييماً جديداً بعد إتمام العقد.',
      link: `/contracts/${contractId}`,
    });

    return this.toReview(review);
  }

  async summaryForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, role: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new NotFoundException('USER_NOT_FOUND');

    return {
      userId: user.id,
      userName: user.fullName,
      role: user.role,
      ...(await this.summary(user.id)),
    };
  }

  private async contractContext(userId: string, contractId: string) {
    const contract = await this.prisma.leaseContract.findUnique({
      where: { id: contractId },
      select: {
        status: true,
        matchConnection: {
          select: {
            tenantId: true,
            ownerId: true,
            tenant: { select: { fullName: true } },
            owner: { select: { fullName: true } },
          },
        },
      },
    });
    if (!contract) throw new NotFoundException('LEASE_CONTRACT_NOT_FOUND');

    const { matchConnection } = contract;
    if (userId === matchConnection.tenantId) {
      return {
        contractStatus: contract.status,
        direction: 'TENANT_TO_LANDLORD' as const,
        revieweeId: matchConnection.ownerId,
        revieweeName: matchConnection.owner.fullName,
      };
    }
    if (userId === matchConnection.ownerId) {
      return {
        contractStatus: contract.status,
        direction: 'LANDLORD_TO_TENANT' as const,
        revieweeId: matchConnection.tenantId,
        revieweeName: matchConnection.tenant.fullName,
      };
    }
    throw new ForbiddenException('NOT_A_PARTY_TO_THIS_CONTRACT');
  }

  private validateDirection(
    direction: UserReviewDirection,
    dto: CreateUserReviewDto,
  ) {
    if (
      direction === 'TENANT_TO_LANDLORD' &&
      (dto.propertyAccuracyRating === undefined ||
        dto.commitmentRating !== undefined)
    ) {
      throw new BadRequestException('TENANT_REVIEW_REQUIRES_PROPERTY_ACCURACY');
    }
    if (
      direction === 'LANDLORD_TO_TENANT' &&
      (dto.commitmentRating === undefined ||
        dto.propertyAccuracyRating !== undefined)
    ) {
      throw new BadRequestException('LANDLORD_REVIEW_REQUIRES_COMMITMENT');
    }
  }

  private async summary(revieweeId: string) {
    const aggregate = await this.prisma.userReview.aggregate({
      where: { revieweeId },
      _count: { _all: true },
      _avg: {
        overallRating: true,
        communicationRating: true,
        responsivenessRating: true,
        propertyAccuracyRating: true,
        commitmentRating: true,
      },
    });
    const round = (value: number | null) =>
      value === null ? null : Number(value.toFixed(1));
    return {
      total: aggregate._count._all,
      overallRating: round(aggregate._avg.overallRating),
      communicationRating: round(aggregate._avg.communicationRating),
      responsivenessRating: round(aggregate._avg.responsivenessRating),
      propertyAccuracyRating: round(aggregate._avg.propertyAccuracyRating),
      commitmentRating: round(aggregate._avg.commitmentRating),
    };
  }

  private toReview(review: {
    id: string;
    direction: UserReviewDirection;
    overallRating: number;
    communicationRating: number;
    responsivenessRating: number;
    propertyAccuracyRating: number | null;
    commitmentRating: number | null;
    createdAt: Date;
  }) {
    return {
      ...review,
      createdAt: review.createdAt.toISOString(),
    };
  }

  private errorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object' || !('code' in error)) return null;
    const code: unknown = error.code;
    return typeof code === 'string' ? code : null;
  }
}
