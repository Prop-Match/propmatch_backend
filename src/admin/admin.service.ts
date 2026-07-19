import { NotificationType } from '@generated/prisma/enums';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { I18nContext } from 'nestjs-i18n';
import { transformUserToFrontend } from '../users/mappers/user.mapper';
import { PrismaService } from './../../prisma/prisma.service';
import { RealtimeService } from './../realtime/realtime.service';
import { CreateAdminDto } from './dto/create-admin.dto';
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
  async getSession(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found.');
    return {
      id: userId,
      fullName: user.fullName,
      role: 'super-admin',
      roleName: 'مشرف عام',
      capabilities: [
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
      ],
    };
  }

  async reviewKyc(
    adminId: string,
    userId: string,
    reviewDecisionDto: ReviewDecisionDto,
  ) {
    const isApproved = reviewDecisionDto.decision === 'approve';
    if (!isApproved && !reviewDecisionDto.reason?.trim()) {
      throw new BadRequestException(
        I18nContext.current()?.t('admin.REASON_REQUIRED'),
      );
    }
    const v = await this.prismaService.identityVerification.findUnique({
      where: { userId },
    });
    if (!v) {
      throw new NotFoundException(I18nContext.current()?.t('admin.NOT_FOUND'));
    }
    if (v.status !== 'PENDING') {
      throw new ConflictException(
        I18nContext.current()?.t('admin.ALREADY_REVIEWED'),
      );
    }

    const status = isApproved ? 'APPROVED' : 'REJECTED';
    await this.prismaService.identityVerification.update({
      where: { userId },
      data: {
        status,
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
    return { ok: true, status };
  }
  async reviewProperty(
    adminId: string,
    propertyId: string,
    reviewDecisionDto: ReviewDecisionDto,
  ) {
    const isApproved = reviewDecisionDto.decision === 'approve';
    if (!isApproved && !reviewDecisionDto.reason?.trim()) {
      throw new BadRequestException(
        I18nContext.current()?.t('admin.REASON_REQUIRED'),
      );
    }
    const p = await this.prismaService.property.findUnique({
      where: { id: propertyId },
    });
    if (!p) {
      throw new NotFoundException(
        I18nContext.current()?.t('admin.PROPERTY_NOT_FOUND'),
      );
    }
    if (p.status !== 'PENDING') {
      throw new ConflictException(
        I18nContext.current()?.t('admin.ALREADY_REVIEWED'),
      );
    }

    const status = isApproved ? 'APPROVED' : 'REJECTED';
    const property = await this.prismaService.property.update({
      where: { id: propertyId },
      data: {
        status,
        approvedBy: adminId,
        approvedAt: new Date(),
      },
    });
    await this.realtimeService.notifyUser(property.ownerId, {
      type: 'PROPERTY_APPROVED',
      title: isApproved ? 'تم قبول عقارك الجديد' : 'تم رفض إعلان العقار',
      message: isApproved
        ? `تمت الموافقة على نشر عقارك "${property.title}" وهو متاح للمستأجرين الآن.`
        : `لم نتمكن من الموافقة على عقارك. السبب: ${reviewDecisionDto.reason}`,
      link: `/landlord/properties/${property.id}`,
    });

    return { status };
  }
  async reviewRequest(
    adminId: string,
    requestId: string,
    reviewDecisionDto: ReviewDecisionDto,
  ) {
    const isApproved = reviewDecisionDto.decision === 'approve';
    if (!isApproved && !reviewDecisionDto.reason?.trim()) {
      throw new BadRequestException(
        I18nContext.current()?.t('admin.REASON_REQUIRED'),
      );
    }
    const r = await this.prismaService.tenantRequest.findUnique({
      where: { id: requestId },
    });
    if (!r) {
      throw new NotFoundException(
        I18nContext.current()?.t('admin.REQUEST_NOT_FOUND'),
      );
    }
    if (r.status !== 'PENDING') {
      throw new ConflictException(
        I18nContext.current()?.t('admin.ALREADY_REVIEWED'),
      );
    }

    const status = isApproved ? 'APPROVED' : 'REJECTED';
    const request = await this.prismaService.tenantRequest.update({
      where: { id: requestId },
      data: {
        approvedBy: adminId,
        status,
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
    return { status };
  }
  async reviewUserReview(
    adminId: string,
    reviewDecisionDto: ReviewDecisionDto,
    reviewId: string,
  ) {
    const isApproved = reviewDecisionDto.decision === 'approve';
    if (!isApproved && !reviewDecisionDto.reason?.trim()) {
      throw new BadRequestException(
        I18nContext.current()?.t('admin.REASON_REQUIRED'),
      );
    }
    const ur = await this.prismaService.propertyReview.findUnique({
      where: { id: reviewId },
    });
    if (!ur) {
      throw new NotFoundException(
        I18nContext.current()?.t('admin.REVIEW_NOT_FOUND'),
      );
    }
    if (ur.status !== 'PENDING') {
      throw new ConflictException(
        I18nContext.current()?.t('admin.ALREADY_REVIEWED'),
      );
    }

    const status = isApproved ? 'APPROVED' : 'REJECTED';
    const userReview = await this.prismaService.propertyReview.update({
      where: { id: reviewId },
      data: {
        status,
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
    return { status };
  }
  async createAdmin(
    creatorId: string | undefined,
    createAdminDto: CreateAdminDto,
  ) {
    // 1. Check if there are already any admins in the system
    const adminCount = await this.prismaService.user.count({
      where: { role: 'ADMIN' },
    });

    if (adminCount > 0) {
      if (!creatorId) {
        throw new UnauthorizedException(
          I18nContext.current()?.t('admin.ONLY_SUPER_ADMIN_CAN_CREATE_ADMIN'),
        );
      }
      const superAdmin = await this.prismaService.user.findUnique({
        where: { id: creatorId },
      });
      if (!superAdmin || superAdmin.role === 'ADMIN') {
        throw new ForbiddenException(
          I18nContext.current()?.t('admin.ONLY_SUPER_ADMIN_CAN_CREATE_ADMIN'),
        );
      }
    }
    // 2. Prevent duplicate emails
    const existingUser = await this.prismaService.user.findUnique({
      where: { email: createAdminDto.email },
    });
    if (existingUser) {
      throw new ConflictException(
        I18nContext.current()?.t('auth.EMAIL_EXISTS'),
      );
    }
    // 3. Hash password and persist new Admin
    const salt = 10;
    const hashedPassword = await bcrypt.hash(createAdminDto.password, salt);
    const admin = await this.prismaService.user.create({
      data: {
        fullName: createAdminDto.fullName,
        email: createAdminDto.email,
        passwordHash: hashedPassword,
        phoneNumber: createAdminDto.phoneNumber,
        role: 'ADMIN',
      },
    });
    return transformUserToFrontend(admin);
  }

  async getTeam() {
    const admins = await this.prismaService.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: admins.map((admin) => ({
        id: admin.id,
        fullName: admin.fullName,
        email: admin.email,
        role: 'super-admin',
        capabilities: [
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
        ],
        disabled: !admin.isActive,
        lastLoginAt: admin.lastLoginAt?.toISOString() || null,
        createdAt: admin.createdAt.toISOString(),
      })),
    };
  }

  async updateTeamMember(
    id: string,
    dto: { role?: string; disabled?: boolean },
  ) {
    const data: any = {};
    if (dto.disabled !== undefined) {
      data.isActive = !dto.disabled;
    }
    const admin = await this.prismaService.user.update({
      where: { id },
      data,
    });
    return {
      id: admin.id,
      fullName: admin.fullName,
      email: admin.email,
      role: dto.role || 'super-admin',
      capabilities: [
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
      ],
      disabled: !admin.isActive,
      lastLoginAt: admin.lastLoginAt?.toISOString() || null,
      createdAt: admin.createdAt.toISOString(),
    };
  }
}
