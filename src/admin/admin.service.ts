import { NotificationType } from '@generated/prisma/enums';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './../../prisma/prisma.service';
import { RealtimeService } from './../realtime/realtime.service';
import { ReviewDecisionDto } from './dto/review-decision.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}
  async getQueues() {
    const [kyc, properties, requests, reviews] = await Promise.all([
      this.prismaService.identityVerification.findMany({
        where: { status: 'PENDING' },
        include: { user: true },
        orderBy: { submittedAt: 'desc' },
      }),
      this.prismaService.property.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.tenantRequest.findMany({
        where: { status: 'PENDING' },
        include: { tenant: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.propertyReview.findMany({
        where: { status: 'PENDING' },
        include: { reviewer: true, property: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      kycQueue: kyc.map((k) => ({
        id: `q_kyc_${k.id}`,
        type: 'kyc',
        subjectId: k.userId,
        title: k.user.fullName,
        subtitle: k.user.email,
        submittedAt: k.submittedAt.toISOString(),
      })),
      propertyQueue: properties.map((p) => ({
        id: `q_prop_${p.id}`,
        type: 'property',
        subjectId: p.id,
        title: p.title,
        subtitle: `Rent Amount: EGP ${p.rentAmount}`,
        submittedAt: p.createdAt.toISOString(),
      })),
      requestQueue: requests.map((r) => ({
        id: `q_req_${r.id}`,
        type: 'request',
        subjectId: r.id,
        title: `Request for ${r.propertyType}`,
        subtitle: `Budget: EGP ${r.minBudget} - ${r.maxBudget}`,
        submittedAt: r.createdAt.toISOString(),
      })),
      reviewQueue: reviews.map((rev) => ({
        id: `q_rev_${rev.id}`,
        type: 'review',
        subjectId: rev.id,
        title: `Review on ${rev.property.title} by ${rev.reviewer.fullName}`,
        subtitle: `Rating: ${rev.rating}/5. ${rev.comment ?? ''}`,
        submittedAt: rev.createdAt.toISOString(),
      })),
    };
  }

  // retrieves national ID & selfie keys for verification review.
  async getKyc(id: string) {
    const identityVerification =
      await this.prismaService.identityVerification.findUnique({
        where: { userId: id },
        include: { user: true },
      });
    if (!identityVerification) {
      throw new NotFoundException(
        'IDENTITY_VERIFICATION_NOT_FOUND_FOR_THIS_USER',
      );
    }
    return {
      userId: identityVerification.userId,
      userName: identityVerification.user.fullName,
      nationalId: identityVerification.nationalId,
      nationalIdFrontUrl: identityVerification.nationalIdFrontUrl,
      nationalIdBackUrl: identityVerification.nationalIdBackUrl,
      selfieUrl: identityVerification.selfieUrl,
      submittedAt: identityVerification.submittedAt.toISOString(),
    };
  }
  async reviewKyc(
    adminId: string,
    userId: string,
    reviewDecisionDto: ReviewDecisionDto,
  ) {
    const isApproved = reviewDecisionDto.decision === 'approve';
    await this.prismaService.identityVerification.update({
      where: { userId },
      data: {
        status: isApproved ? 'APPROVED' : 'REJECTED',
        reviewedBy: adminId,
        reviewedAt: new Date(),
        rejectionReason: !isApproved ? reviewDecisionDto.reason : null,
      },
    });
    await this.realtimeService.notifyUser(userId, {
      type: NotificationType.EKYC_APPROVED,
      title: isApproved
        ? 'Identity Verification Approved'
        : 'Identity Verification Rejected',
      message: isApproved
        ? 'Your identity verification has been approved.'
        : `Your identity verification has been rejected. Reason: ${reviewDecisionDto.reason}`,
      link: '/profile',
    });
    return { ok: true };
  }
  async reviewProperty(
    adminId: string,
    propertyId: string,
    reviewDecisionDto: ReviewDecisionDto,
  ) {
    const isApproved = reviewDecisionDto.decision === 'approve';
    const property = await this.prismaService.property.update({
      where: { id: propertyId },
      data: {
        status: isApproved ? 'APPROVED' : 'REJECTED',
        approvedBy: adminId,
        approvedAt: new Date(),
      },
    });
    if (!property) {
      throw new NotFoundException('PROPERTY_NOT_FOUND');
    }
    await this.realtimeService.notifyUser(property.ownerId, {
      type: 'PROPERTY_APPROVED',
      title: isApproved ? 'تم قبول عقارك الجديد' : 'تم رفض إعلان العقار',
      message: isApproved
        ? `تمت الموافقة على نشر عقارك "${property.title}" وهو متاح للمستأجرين الآن.`
        : `لم نتمكن من الموافقة على عقارك. السبب: ${reviewDecisionDto.reason}`,
      link: `/landlord/properties/${property.id}`,
    });

    return { ok: true };
  }
  async reviewRequest(
    adminId: string,
    requestId: string,
    reviewDecisionDto: ReviewDecisionDto,
  ) {
    const isApproved = reviewDecisionDto.decision === 'approve';
    const request = await this.prismaService.tenantRequest.update({
      where: { id: requestId },
      data: {
        approvedBy: adminId,
        status: isApproved ? 'APPROVED' : 'REJECTED',
      },
    });
    await this.realtimeService.notifyUser(request.tenantId, {
      type: 'NEW_TENANT_REQUEST',
      title: isApproved ? 'تم قبول طلبك' : 'تم رفض طلبك',
      message: isApproved
        ? 'تمت الموافقة على طلبك.'
        : `تم رفض طلبك. السبب: ${reviewDecisionDto.reason}`,
      link: '/tenant/requests',
    });
    return { ok: true };
  }
  async reviewUserReview(
    adminId: string,
    reviewDecisionDto: ReviewDecisionDto,
    reviewId: string,
  ) {
    const isApproved = reviewDecisionDto.decision === 'approve';
    const userReview = await this.prismaService.propertyReview.update({
      where: { id: reviewId },
      data: {
        status: isApproved ? 'APPROVED' : 'REJECTED',
        reviewedBy: adminId,
      },
    });
    await this.realtimeService.notifyUser(userReview.reviewerId, {
      type: 'REVIEW_APPROVED',
      title: isApproved ? 'تم قبول ونشر تقييمك' : 'تم رفض نشر تقييمك',
      message: isApproved
        ? 'تقييمك العقاري أصبح مرئيًا الآن على صفحة تفاصيل العقار.'
        : `لم نتمكن من نشر تقييمك. السبب: ${reviewDecisionDto.reason}`,
      link: `/tenant/properties/${userReview.propertyId}`,
    });
    return { ok: true };
  }
}
