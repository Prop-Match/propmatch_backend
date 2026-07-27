import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  /**
   * POST /reviews (SRS 3.7). Tenant verification is enforced by
   * VerifiedGuard. Review starts PENDING — admin must approve before it's
   * publicly visible.
   */
  async create(reviewerId: string, dto: CreateReviewDto) {
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, status: 'APPROVED' },
    });
    if (!property) throw new NotFoundException('غير موجود');

    const review = await this.prisma.propertyReview.create({
      data: {
        reviewerId,
        propertyId: dto.propertyId,
        rating: dto.rating,
        comment: dto.comment,
        // status defaults to PENDING via Prisma schema
      },
    });

    this.realtimeService.reviewSubmitted(review);

    await this.realtimeService.notifyUser(property.ownerId, {
      type: 'NEW_REVIEW_SUBMITTED',
      title: 'تقييم جديد',
      message: 'تم إرسال تقييم جديد لعقارك للمراجعة.',
    });

    return { id: review.id, status: review.status };
  }

  /** GET /properties/:id/reviews — public, APPROVED-only. */
  async findForProperty(propertyId: string) {
    const reviews = await this.prisma.propertyReview.findMany({
      where: { propertyId, status: 'APPROVED' },
      include: { reviewer: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const total = reviews.length;
    const averageRating = total
      ? Number(
          (reviews.reduce((sum, r) => sum + r.rating, 0) / total).toFixed(1),
        )
      : null;

    return {
      items: reviews.map((r) => ({
        id: r.id,
        propertyId: r.propertyId,
        reviewerName: r.reviewer.fullName,
        rating: r.rating,
        comment: r.comment ?? '',
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      averageRating,
      total,
      distribution: [5, 4, 3, 2, 1].map((rating) => ({
        rating,
        count: reviews.filter((r) => r.rating === rating).length,
      })),
    };
  }
}
