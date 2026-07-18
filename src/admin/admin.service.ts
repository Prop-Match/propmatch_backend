import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ReviewDecisionDto } from './dto/review-decision.dto';

/** No admin-sub-role table exists yet (frontend's ASSUMPTIONS.md #26) — every
 * ADMIN user currently holds the full capability set. */
const SUPER_ADMIN_CAPABILITIES = [
  'property:approve',
  'property:reject',
  'kyc:review',
  'request:approve',
  'request:reject',
  'review:moderate',
  'payment:view',
  'partner_lead:view',
  'report:export',
  'ticket:reply',
  'audit:view',
  'admin:create',
  'admin:manage',
];

type QueueItem = {
  id: string;
  type: 'kyc' | 'property' | 'request' | 'review';
  subjectId: string;
  title: string;
  subtitle: string;
  submittedAt: string;
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  private reasonRequired() {
    return I18nContext.current()?.t('admin.REASON_REQUIRED');
  }
  private alreadyReviewed() {
    return I18nContext.current()?.t('admin.ALREADY_REVIEWED');
  }
  private notFound() {
    return I18nContext.current()?.t('admin.NOT_FOUND');
  }

  async getSession(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException(this.notFound());
    return {
      id: userId,
      fullName: user.fullName,
      role: 'super-admin',
      roleName: I18nContext.current()?.t('admin.SUPER_ADMIN_ROLE_NAME'),
      capabilities: SUPER_ADMIN_CAPABILITIES,
    };
  }

  async getQueues() {
    const [verifications, properties, requests, reviews] = await Promise.all([
      this.prisma.identityVerification.findMany({
        where: { status: 'PENDING' },
        include: { user: true },
      }),
      this.prisma.property.findMany({ where: { status: 'PENDING' } }),
      this.prisma.tenantRequest.findMany({ where: { status: 'PENDING' } }),
      this.prisma.propertyReview.findMany({ where: { status: 'PENDING' } }),
    ]);

    const kycQueue: QueueItem[] = verifications.map((v) => ({
      id: `q_${v.id}`,
      type: 'kyc',
      subjectId: v.userId,
      title: v.user.fullName,
      subtitle: 'مستخدم جديد بحاجة لمراجعة',
      submittedAt: v.submittedAt.toISOString(),
    }));

    const propertyQueue: QueueItem[] = properties.map((p) => ({
      id: `q_${p.id}`,
      type: 'property',
      subjectId: p.id,
      title: p.title,
      subtitle: `${p.district} · ${p.rentAmount} ج.م/شهريًا`,
      submittedAt: p.createdAt.toISOString(),
    }));

    const requestQueue: QueueItem[] = requests.map((r) => ({
      id: `q_${r.id}`,
      type: 'request',
      subjectId: r.id,
      title: `طلب سكن في ${r.preferredLocations}`,
      subtitle: `${r.minBudget}–${r.maxBudget} ج.م`,
      submittedAt: r.createdAt.toISOString(),
    }));

    const reviewQueue: QueueItem[] = reviews.map((r) => ({
      id: `q_${r.id}`,
      type: 'review',
      subjectId: r.id,
      title: `تقييم ${r.rating}★`,
      subtitle: r.comment?.slice(0, 60) ?? '',
      submittedAt: r.createdAt.toISOString(),
    }));

    return { kycQueue, propertyQueue, requestQueue, reviewQueue };
  }

  async getKycDetail(userId: string) {
    const v = await this.prisma.identityVerification.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (!v) throw new NotFoundException(this.notFound());
    return {
      userId: v.userId,
      userName: v.user.fullName,
      nationalId: v.nationalId,
      nationalIdFrontUrl: v.nationalIdFrontUrl,
      nationalIdBackUrl: v.nationalIdBackUrl,
      selfieUrl: v.selfieUrl,
      submittedAt: v.submittedAt.toISOString(),
    };
  }

  async reviewKyc(
    userId: string,
    adminId: string,
    decision: ReviewDecisionDto,
  ) {
    const v = await this.prisma.identityVerification.findUnique({
      where: { userId },
    });
    if (!v || v.status !== 'PENDING')
      throw new ConflictException(this.alreadyReviewed());
    if (decision.decision === 'reject' && !decision.reason?.trim()) {
      throw new BadRequestException(this.reasonRequired());
    }
    await this.prisma.identityVerification.update({
      where: { userId },
      data: {
        status: decision.decision === 'approve' ? 'APPROVED' : 'REJECTED',
        rejectionReason:
          decision.decision === 'reject' ? decision.reason!.trim() : null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });
    return { ok: true };
  }

  async reviewProperty(
    propertyId: string,
    adminId: string,
    decision: ReviewDecisionDto,
  ) {
    const p = await this.prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!p || p.status !== 'PENDING')
      throw new ConflictException(this.alreadyReviewed());
    if (decision.decision === 'reject' && !decision.reason?.trim()) {
      throw new BadRequestException(this.reasonRequired());
    }
    const status = decision.decision === 'approve' ? 'APPROVED' : 'REJECTED';
    // Property has no rejection-reason column yet (schema gap — flagged, not fixed here).
    await this.prisma.property.update({
      where: { id: propertyId },
      data: {
        status,
        approvedBy: adminId,
        approvedAt: decision.decision === 'approve' ? new Date() : null,
      },
    });
    return { status };
  }

  async getRequestDetail(id: string) {
    const r = await this.prisma.tenantRequest.findUnique({
      where: { id },
      include: { tenant: { include: { identityVerification: true } } },
    });
    if (!r) throw new NotFoundException(this.notFound());
    return {
      id: r.id,
      tenantName: r.tenant.fullName,
      tenantVerified: r.tenant.identityVerification?.status === 'APPROVED',
      minBudget: r.minBudget,
      maxBudget: r.maxBudget,
      preferredLocations: r.preferredLocations,
      propertyType: r.propertyType,
      requiredBedrooms: r.requiredBedrooms,
      needsFurnished: r.needsFurnished,
      flexibilityScore: r.flexibilityScore,
      lifestyleRequirements: r.lifestyleRequirements,
      status: r.status,
      rejectionReason: null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async reviewRequest(
    id: string,
    adminId: string,
    decision: ReviewDecisionDto,
  ) {
    const r = await this.prisma.tenantRequest.findUnique({ where: { id } });
    if (!r || r.status !== 'PENDING')
      throw new ConflictException(this.alreadyReviewed());
    if (decision.decision === 'reject' && !decision.reason?.trim()) {
      throw new BadRequestException(this.reasonRequired());
    }
    const status = decision.decision === 'approve' ? 'APPROVED' : 'REJECTED';
    await this.prisma.tenantRequest.update({
      where: { id },
      data: { status, approvedBy: adminId },
    });
    return { status };
  }

  async getReviewDetail(id: string) {
    const r = await this.prisma.propertyReview.findUnique({
      where: { id },
      include: { reviewer: true, property: true },
    });
    if (!r) throw new NotFoundException(this.notFound());
    return {
      id: r.id,
      reviewerName: r.reviewer.fullName,
      propertyId: r.propertyId,
      propertyTitle: r.property.title,
      rating: r.rating,
      comment: r.comment ?? '',
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async reviewReview(id: string, adminId: string, decision: ReviewDecisionDto) {
    const r = await this.prisma.propertyReview.findUnique({ where: { id } });
    if (!r || r.status !== 'PENDING')
      throw new ConflictException(this.alreadyReviewed());
    if (decision.decision === 'reject' && !decision.reason?.trim()) {
      throw new BadRequestException(this.reasonRequired());
    }
    const status = decision.decision === 'approve' ? 'APPROVED' : 'REJECTED';
    await this.prisma.propertyReview.update({
      where: { id },
      data: { status, reviewedBy: adminId },
    });
    return { status };
  }
}
