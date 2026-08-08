import { AdminRole, NotificationType } from '@generated/prisma/enums';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Queue } from 'bullmq';
import { I18nContext } from 'nestjs-i18n';
import {
  adminRoleFromSlug,
  capabilitiesFor,
  roleLabelFor,
  roleSlugFor,
} from './capabilities';
import { PropertyApprovalIndexingService } from '../properties/property-approval-indexing.service';
import {
  MATCH_TENANT_REQUEST_JOB,
  MATCHING_QUEUE,
  MatchTenantRequestJobData,
} from '../matching/matching.constants';
import type { PrivateObjectStorage } from '../storage/private-object-storage.interface';
import { PRIVATE_OBJECT_STORAGE } from '../storage/private-object-storage.token';
import {
  SUSPENSION_REASONS,
  isSuspensionActive,
  suspensionMessage,
  type SuspensionReasonCode,
} from '../common/suspension';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { transformUserToFrontend } from '../users/mappers/user.mapper';
import { PrismaService } from './../../prisma/prisma.service';
import { RealtimeService } from './../realtime/realtime.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ReviewDecisionDto } from './dto/review-decision.dto';
import { AdminStats } from './interfaces/admin-stats.interface';

const KYC_DOCUMENT_READ_TTL_SECONDS = 300;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly realtimeService: RealtimeService,
    @Inject(PRIVATE_OBJECT_STORAGE)
    private readonly privateObjectStorage: PrivateObjectStorage,
    private readonly propertyApprovalIndexingService: PropertyApprovalIndexingService,
    @InjectQueue(MATCHING_QUEUE)
    private readonly matchingQueue: Queue<MatchTenantRequestJobData>,
  ) {}
  private getTranslation(key: string, fallback: string): string {
    return I18nContext.current()?.t(key) ?? fallback;
  }

  /** Append-only record of a moderation decision, for the team activity page. */
  private async audit(
    actorId: string,
    action: string,
    subjectId: string,
  ): Promise<void> {
    await this.prismaService.adminAuditLogEntry.create({
      data: { actorId, action, subjectId },
    });
  }

  private toUserRow(u: {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    role: string;
    isActive: boolean;
    createdAt: Date;
    suspendedAt: Date | null;
    suspendedUntil: Date | null;
    suspensionReason: string | null;
    suspensionNote?: string | null;
  }) {
    const suspended = isSuspensionActive(u);
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      phoneNumber: u.phoneNumber,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt.toISOString(),
      suspended,
      suspendedUntil: suspended ? (u.suspendedUntil?.toISOString() ?? null) : null,
      suspendedAt: suspended ? (u.suspendedAt?.toISOString() ?? null) : null,
      suspensionReason: suspended ? u.suspensionReason : null,
      suspensionReasonLabel:
        suspended && u.suspensionReason
          ? (SUSPENSION_REASONS[u.suspensionReason as SuspensionReasonCode] ??
            u.suspensionReason)
          : null,
      suspensionNote: suspended ? (u.suspensionNote ?? null) : null,
    };
  }

  /** Paginated, searchable list of non-admin users for the suspension console. */
  async listUsers(query: { search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20));
    const search = query.search?.trim();
    const where = {
      role: { not: 'ADMIN' as const },
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { phoneNumber: { contains: search } },
            ],
          }
        : {}),
    };
    const select = {
      id: true,
      fullName: true,
      email: true,
      phoneNumber: true,
      role: true,
      isActive: true,
      createdAt: true,
      suspendedAt: true,
      suspendedUntil: true,
      suspensionReason: true,
      suspensionNote: true,
    };
    const [rows, total] = await Promise.all([
      this.prismaService.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select,
      }),
      this.prismaService.user.count({ where }),
    ]);
    return { items: rows.map((u) => this.toUserRow(u)), total, page, pageSize };
  }

  /** Suspend a non-admin account. `durationDays` null ⇒ permanent. */
  async suspendUser(actorId: string, targetUserId: string, dto: SuspendUserDto) {
    if (actorId === targetUserId) {
      throw new BadRequestException('لا يمكنك إيقاف حسابك الخاص');
    }
    const target = await this.prismaService.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException('المستخدم غير موجود');
    if (target.role === 'ADMIN') {
      throw new BadRequestException('لا يمكن إيقاف حساب مشرف من هنا');
    }
    const now = new Date();
    const suspendedUntil =
      dto.durationDays == null
        ? null
        : new Date(now.getTime() + dto.durationDays * 24 * 60 * 60 * 1000);
    const updated = await this.prismaService.user.update({
      where: { id: targetUserId },
      data: {
        suspendedAt: now,
        suspendedUntil,
        suspensionReason: dto.reason,
        suspensionNote: dto.note?.trim() || null,
        suspendedById: actorId,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        createdAt: true,
        suspendedAt: true,
        suspendedUntil: true,
        suspensionReason: true,
        suspensionNote: true,
      },
    });
    await this.audit(
      actorId,
      `user:suspend:${dto.reason}:${dto.durationDays ?? 'permanent'}`,
      targetUserId,
    );
    // Push a real-time notice so a currently-logged-in user is told immediately,
    // not only when they next hit the API. Best-effort — the DB row is the
    // source of truth for the block.
    try {
      this.realtimeService.emitAccountSuspended(targetUserId, {
        message: suspensionMessage(updated),
        reason: this.toUserRow(updated).suspensionReasonLabel,
        suspendedUntil: updated.suspendedUntil?.toISOString() ?? null,
      });
    } catch (error) {
      this.logger.warn(`Suspension realtime push failed: ${String(error)}`);
    }
    return this.toUserRow(updated);
  }

  /** Lift a suspension immediately. */
  async unsuspendUser(actorId: string, targetUserId: string) {
    const target = await this.prismaService.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('المستخدم غير موجود');
    const updated = await this.prismaService.user.update({
      where: { id: targetUserId },
      data: {
        suspendedAt: null,
        suspendedUntil: null,
        suspensionReason: null,
        suspensionNote: null,
        suspendedById: null,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        createdAt: true,
        suspendedAt: true,
        suspendedUntil: true,
        suspensionReason: true,
        suspensionNote: true,
      },
    });
    await this.audit(actorId, 'user:unsuspend', targetUserId);
    return this.toUserRow(updated);
  }
  async getQueues() {
    const [kyc, properties, editedProperties, requests, reviews] =
      await Promise.all([
        this.prismaService.identityVerification.findMany({
          where: { status: 'PENDING' },
          include: { user: true },
          orderBy: { submittedAt: 'desc' },
        }),
        this.prismaService.property.findMany({
          where: { status: 'PENDING', approvedAt: null },
          orderBy: { createdAt: 'desc' },
        }),
        this.prismaService.property.findMany({
          where: { status: 'PENDING', approvedAt: { not: null } },
          orderBy: { updatedAt: 'desc' },
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
      editedPropertyQueue: editedProperties.map((p) => ({
        id: `q_prop_edit_${p.id}`,
        type: 'propertyEdit',
        subjectId: p.id,
        title: p.title,
        subtitle: `تم تعديل الإعلان · الإيجار: ${p.rentAmount} ج.م`,
        submittedAt: p.updatedAt.toISOString(),
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
    const getUrl = async (keyOrUrl: string) => {
      if (!keyOrUrl) return '';
      if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
        return keyOrUrl;
      }
      return this.privateObjectStorage.createTemporaryReadUrl(
        keyOrUrl,
        KYC_DOCUMENT_READ_TTL_SECONDS,
      );
    };

    const [nationalIdFrontUrl, nationalIdBackUrl, selfieUrl] =
      await Promise.all([
        getUrl(identityVerification.nationalIdFrontUrl),
        getUrl(identityVerification.nationalIdBackUrl),
        getUrl(identityVerification.selfieUrl),
      ]);
    return {
      userId: identityVerification.userId,
      userName: identityVerification.user.fullName,
      nationalId: identityVerification.nationalId,
      nationalIdFrontUrl,
      nationalIdBackUrl,
      selfieUrl,
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
      role: roleSlugFor(user.adminRole),
      roleName: roleLabelFor(user.adminRole),
      capabilities: capabilitiesFor(user.adminRole),
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

    const status = isApproved ? 'APPROVED' : 'RESUBMISSION_REQUIRED';
    await this.prismaService.identityVerification.update({
      where: { userId },
      data: {
        status,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        rejectionReason: !isApproved ? reviewDecisionDto.reason : null,
      },
    });
    await this.audit(adminId, `kyc:${reviewDecisionDto.decision}`, userId);
    // Rejections don't get a push notification: the ERD's NotificationType
    // enum has no EKYC_REJECTED value, and the bell renders strictly by
    // `type` (requirements.md §6) — sending EKYC_APPROVED here would show a
    // rejected user an approval-styled notification. The user still sees
    // the RESUBMISSION_REQUIRED status on their next profile fetch.
    if (isApproved) {
      await this.realtimeService.notifyUser(userId, {
        type: NotificationType.EKYC_APPROVED,
        title:
          I18nContext.current()?.t('admin.TITLE_KYC_APPROVED') ||
          'تم قبول توثيق الهوية',
        message:
          I18nContext.current()?.t('admin.MSG_KYC_APPROVED') ||
          'تمت الموافقة على توثيق هويتك بنجاح.',
        link: '/profile',
      });
    }
    return {
      message: I18nContext.current()?.t('admin.REVIEW_SUCCESS_MESSAGE', {
        args: { status },
      }),
      status,
    };
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
    const property = await this.prismaService.$transaction((tx) =>
      tx.property.update({
        where: { id: propertyId },
        data: {
          status,
          approvedBy: adminId,
          approvedAt: new Date(),
        },
      }),
    );
    await this.audit(
      adminId,
      `property:${reviewDecisionDto.decision}`,
      propertyId,
    );
    if (p.status === 'PENDING' && property.status === 'APPROVED') {
      try {
        await this.propertyApprovalIndexingService.indexApprovedProperty(
          property.id,
        );
      } catch (error) {
        this.propertyApprovalIndexingService.logIndexingFailure(
          property.id,
          error,
        );
      }
    }
    await this.realtimeService.notifyUser(property.ownerId, {
      type: 'PROPERTY_APPROVED',
      title:
        I18nContext.current()?.t(
          isApproved
            ? 'admin.TITLE_PROPERTY_APPROVED'
            : 'admin.TITLE_PROPERTY_REJECTED',
        ) || (isApproved ? 'تم قبول عقارك الجديد' : 'تم رفض إعلان العقار'),
      message:
        I18nContext.current()?.t(
          isApproved
            ? 'admin.MSG_PROPERTY_APPROVED'
            : 'admin.MSG_PROPERTY_REJECTED',
          { args: { title: property.title, reason: reviewDecisionDto.reason } },
        ) ||
        (isApproved
          ? `تمت الموافقة على نشر عقارك "${property.title}" وهو متاح للمستأجرين الآن.`
          : `لم نتمكن من الموافقة على عقارك. السبب: ${reviewDecisionDto.reason ?? ''}`),
      link: `/landlord/properties/${property.id}`,
    });
    return {
      message: I18nContext.current()?.t('admin.REVIEW_SUCCESS_MESSAGE', {
        args: { status },
      }),
      status,
    };
  }

  /** A deliberately small, moderation-only projection. It must not reuse the
   * general property detail mapper because that mapper may reveal contact data. */
  async getPropertyReviewDetail(propertyId: string) {
    const property = await this.prismaService.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        title: true,
        description: true,
        governorate: { select: { nameAr: true, nameEn: true } },
        city: { select: { nameAr: true, nameEn: true } },
        district: true,
        manualAddress: true,
        propertyType: true,
        rentAmount: true,
        areaM2: true,
        bedrooms: true,
        bathrooms: true,
        isFurnished: true,
        hasElevator: true,
        hasParking: true,
        propertyAroundServices: true,
        status: true,
        createdAt: true,
        propertyImages: {
          orderBy: { displayOrder: 'asc' },
          select: {
            id: true,
            imageUrl: true,
            displayOrder: true,
            isCover: true,
          },
        },
        owner: {
          select: {
            fullName: true,
            identityVerification: { select: { status: true } },
          },
        },
      },
    });

    if (!property) {
      throw new NotFoundException(
        I18nContext.current()?.t('admin.PROPERTY_NOT_FOUND'),
      );
    }

    const { propertyImages, owner, governorate, city, ...detail } = property;
    const lang = I18nContext.current()?.lang ?? 'ar';
    const isAr = lang.startsWith('ar');
    return {
      ...detail,
      governorate: isAr
        ? (governorate?.nameAr ?? governorate?.nameEn ?? '')
        : (governorate?.nameEn ?? governorate?.nameAr ?? ''),
      city: isAr
        ? (city?.nameAr ?? city?.nameEn ?? '')
        : (city?.nameEn ?? city?.nameAr ?? ''),
      images: propertyImages,
      ownerName: owner.fullName,
      ownerVerificationStatus:
        owner.identityVerification?.status ?? 'NOT_SUBMITTED',
    };
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
    await this.audit(
      adminId,
      `request:${reviewDecisionDto.decision}`,
      requestId,
    );

    if (isApproved) {
      // Smart Matchmaker only runs on vetted requests — enqueueing at
      // creation would score/notify landlords about a request an admin
      // might still reject. A queue hiccup here must not fail the
      // moderation decision, so it's logged and swallowed, not thrown.
      try {
        await this.matchingQueue.add(MATCH_TENANT_REQUEST_JOB, {
          tenantRequestId: request.id,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to enqueue matching job for TenantRequest ${request.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    await this.realtimeService.notifyUser(request.tenantId, {
      type: 'NEW_TENANT_REQUEST',
      title:
        I18nContext.current()?.t(
          isApproved
            ? 'admin.TITLE_REQUEST_APPROVED'
            : 'admin.TITLE_REQUEST_REJECTED',
        ) || (isApproved ? 'تم قبول طلبك' : 'تم رفض طلبك'),
      message:
        I18nContext.current()?.t(
          isApproved
            ? 'admin.MSG_REQUEST_APPROVED'
            : 'admin.MSG_REQUEST_REJECTED',
          { args: { reason: reviewDecisionDto.reason } },
        ) ||
        (isApproved
          ? 'تمت الموافقة على طلبك بنجاح.'
          : `تم رفض طلبك. السبب: ${reviewDecisionDto.reason ?? ''}`),
      link: '/tenant/requests',
    });
    return {
      message: I18nContext.current()?.t('admin.REVIEW_SUCCESS_MESSAGE', {
        args: { status },
      }),
      status,
    };
  }

  /** Safe moderation projection: tenant identity is restricted to name and
   * verification status; contact and KYC data never enter this query. */
  async getRequestReviewDetail(requestId: string) {
    const request = await this.prismaService.tenantRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        minBudget: true,
        maxBudget: true,
        preferredLocations: true,
        propertyType: true,
        requiredBedrooms: true,
        needsFurnished: true,
        flexibilityScore: true,
        lifestyleRequirements: true,
        createdAt: true,
        tenant: {
          select: {
            fullName: true,
            identityVerification: { select: { status: true } },
          },
        },
      },
    });
    if (!request) {
      throw new NotFoundException(
        I18nContext.current()?.t('admin.REQUEST_NOT_FOUND'),
      );
    }

    const { tenant, ...detail } = request;
    return {
      ...detail,
      tenantName: tenant.fullName,
      tenantVerificationStatus:
        tenant.identityVerification?.status ?? 'NOT_SUBMITTED',
    };
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
    await this.audit(adminId, `review:${reviewDecisionDto.decision}`, reviewId);
    await this.realtimeService.notifyUser(userReview.reviewerId, {
      type: 'REVIEW_APPROVED',
      title:
        I18nContext.current()?.t(
          isApproved
            ? 'admin.TITLE_REVIEW_APPROVED'
            : 'admin.TITLE_REVIEW_REJECTED',
        ) || (isApproved ? 'تم قبول ونشر تقييمك' : 'تم رفض نشر تقييمك'),
      message:
        I18nContext.current()?.t(
          isApproved
            ? 'admin.MSG_REVIEW_APPROVED'
            : 'admin.MSG_REVIEW_REJECTED',
          { args: { reason: reviewDecisionDto.reason } },
        ) ||
        (isApproved
          ? 'تمت الموافقة على تقييمك وهو منشور الآن.'
          : `تم رفض تقييمك. السبب: ${reviewDecisionDto.reason ?? ''}`),
      link: `/properties/${userReview.propertyId}`,
    });
    return {
      message: I18nContext.current()?.t('admin.REVIEW_SUCCESS_MESSAGE', {
        args: { status },
      }),
      status,
    };
  }

  /** GET admin/reviews/:reviewId — detail fetch, mirrors requests/properties. */
  async getReviewDetail(reviewId: string) {
    const review = await this.prismaService.propertyReview.findUnique({
      where: { id: reviewId },
      include: {
        reviewer: { select: { fullName: true } },
        property: { select: { title: true } },
      },
    });
    if (!review) {
      throw new NotFoundException(
        I18nContext.current()?.t('admin.REVIEW_NOT_FOUND'),
      );
    }
    return {
      id: review.id,
      reviewerName: review.reviewer.fullName,
      propertyId: review.propertyId,
      propertyTitle: review.property.title,
      rating: review.rating,
      comment: review.comment ?? '',
      status: review.status,
      createdAt: review.createdAt.toISOString(),
    };
  }

  /** GET admin/login-history — admin-panel login attempts (team activity page). */
  async getLoginHistory() {
    const attempts = await this.prismaService.loginAttempt.findMany({
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      items: attempts.map((a) => ({
        id: a.id,
        adminName: a.user.fullName,
        ip: a.ip,
        at: a.createdAt.toISOString(),
        success: a.success,
      })),
    };
  }

  /** GET admin/audit-log — append-only moderation action history. */
  async getAuditLog() {
    const entries = await this.prismaService.adminAuditLogEntry.findMany({
      include: { actor: { select: { fullName: true } } },
      orderBy: { at: 'desc' },
      take: 100,
    });
    return {
      items: entries.map((e) => ({
        id: e.id,
        actorName: e.actor.fullName,
        action: e.action,
        subjectId: e.subjectId,
        at: e.at.toISOString(),
      })),
    };
  }

  async createAdmin(
    creatorId: string | undefined,
    createAdminDto: CreateAdminDto,
  ) {
    // 1. Check if there are already any admins in the system
    const adminCount = await this.prismaService.user.count({
      where: { role: 'ADMIN' },
    });

    const isBootstrap = adminCount === 0;
    if (!isBootstrap) {
      if (!creatorId) {
        throw new UnauthorizedException(
          I18nContext.current()?.t('admin.ONLY_SUPER_ADMIN_CAN_CREATE_ADMIN'),
        );
      }
      const creator = await this.prismaService.user.findUnique({
        where: { id: creatorId },
        select: { role: true, adminRole: true },
      });
      // Must be an admin who actually holds `admin:create` — i.e. a SUPER_ADMIN.
      // Previously this only checked role === 'ADMIN', so any sub-role admin
      // (read-only, support, …) could create admins → privilege escalation.
      if (
        !creator ||
        creator.role !== 'ADMIN' ||
        !capabilitiesFor(creator.adminRole).includes('admin:create')
      ) {
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
    // 3. Resolve the sub-role. Only the very first (bootstrap) admin defaults to
    // SUPER_ADMIN; every other new admin defaults to least-privilege READ_ONLY.
    // An explicitly-provided role must be valid — never silently fall back to
    // SUPER_ADMIN (that was the escalation bug).
    let adminRole: AdminRole = isBootstrap ? 'SUPER_ADMIN' : 'READ_ONLY';
    if (createAdminDto.role) {
      const mapped = adminRoleFromSlug(createAdminDto.role);
      if (!mapped) {
        throw new BadRequestException('دور المشرف غير صالح');
      }
      adminRole = mapped;
    }

    // 4. Hash password and persist new Admin
    const salt = 10;
    const hashedPassword = await bcrypt.hash(createAdminDto.password, salt);
    const admin = await this.prismaService.user.create({
      data: {
        fullName: createAdminDto.fullName,
        email: createAdminDto.email,
        passwordHash: hashedPassword,
        phoneNumber: createAdminDto.phoneNumber,
        role: 'ADMIN',
        adminRole,
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
        role: roleSlugFor(admin.adminRole),
        capabilities: capabilitiesFor(admin.adminRole),
        disabled: !admin.isActive,
        lastLoginAt: admin.lastLoginAt?.toISOString() || null,
        createdAt: admin.createdAt.toISOString(),
      })),
    };
  }

  /** A user with SUPER_ADMIN caps: adminRole SUPER_ADMIN, or null (legacy). */
  private static readonly SUPER_ADMIN_WHERE = {
    role: 'ADMIN' as const,
    isActive: true,
    OR: [{ adminRole: 'SUPER_ADMIN' as const }, { adminRole: null }],
  };

  async updateTeamMember(
    actorId: string,
    id: string,
    dto: { role?: string; disabled?: boolean },
  ) {
    const target = await this.prismaService.user.findUnique({
      where: { id },
      select: { id: true, role: true, adminRole: true, isActive: true },
    });
    if (!target || target.role !== 'ADMIN') {
      throw new NotFoundException('المشرف غير موجود');
    }
    // An admin can never change their own role or status here — closes
    // self-demotion lockouts and self-escalation attempts.
    if (target.id === actorId) {
      throw new ForbiddenException('لا يمكنك تعديل دورك أو حالتك بنفسك');
    }

    const data: { isActive?: boolean; adminRole?: AdminRole } = {};
    let nextAdminRole = target.adminRole;
    let nextActive = target.isActive;
    if (dto.role !== undefined) {
      const mapped = adminRoleFromSlug(dto.role);
      if (!mapped) throw new BadRequestException('دور المشرف غير صالح');
      data.adminRole = mapped;
      nextAdminRole = mapped;
    }
    if (dto.disabled !== undefined) {
      data.isActive = !dto.disabled;
      nextActive = !dto.disabled;
    }

    // Guard the last super-admin: if this change would strip the target of
    // active super-admin status, ensure at least one other remains.
    const targetIsSuperAdmin =
      target.isActive && capabilitiesFor(target.adminRole).includes('admin:manage');
    const targetStaysSuperAdmin =
      nextActive && capabilitiesFor(nextAdminRole).includes('admin:manage');
    if (targetIsSuperAdmin && !targetStaysSuperAdmin) {
      const otherSuperAdmins = await this.prismaService.user.count({
        where: { ...AdminService.SUPER_ADMIN_WHERE, id: { not: id } },
      });
      if (otherSuperAdmins === 0) {
        throw new ForbiddenException(
          'لا يمكن إزالة أو تعطيل آخر مشرف عام في النظام',
        );
      }
    }

    const admin = await this.prismaService.user.update({
      where: { id },
      data,
    });
    return {
      id: admin.id,
      fullName: admin.fullName,
      email: admin.email,
      role: roleSlugFor(admin.adminRole),
      capabilities: capabilitiesFor(admin.adminRole),
      disabled: !admin.isActive,
      lastLoginAt: admin.lastLoginAt?.toISOString() || null,
      createdAt: admin.createdAt.toISOString(),
    };
  }

  async getStats(): Promise<AdminStats> {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    // 1. Execute all database queries concurrently in a single Promise.all
    const [
      revenueAggregate,
      activeListingsCount,
      pendingCounts,
      approvedCounts,
      rejectedCounts,
      recentTransactions,
    ] = await Promise.all([
      // DB-native aggregate for total revenue & transaction count
      this.prismaService.paymentTransaction.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
        _count: { _all: true },
      }),

      // Active listings count
      this.prismaService.property.count({
        where: { status: 'APPROVED' },
      }),

      // Pending moderations (Property, Verification, Request, Review)
      Promise.all([
        this.prismaService.property.count({ where: { status: 'PENDING' } }),
        this.prismaService.identityVerification.count({
          where: { status: 'PENDING' },
        }),
        this.prismaService.tenantRequest.count({
          where: { status: 'PENDING' },
        }),
        this.prismaService.propertyReview.count({
          where: { status: 'PENDING' },
        }),
      ]),

      // Approved moderations
      Promise.all([
        this.prismaService.property.count({ where: { status: 'APPROVED' } }),
        this.prismaService.identityVerification.count({
          where: { status: 'APPROVED' },
        }),
        this.prismaService.tenantRequest.count({
          where: { status: 'APPROVED' },
        }),
        this.prismaService.propertyReview.count({
          where: { status: 'APPROVED' },
        }),
      ]),

      // Rejected moderations
      Promise.all([
        this.prismaService.property.count({ where: { status: 'REJECTED' } }),
        this.prismaService.identityVerification.count({
          where: { status: 'REJECTED' },
        }),
        this.prismaService.tenantRequest.count({
          where: { status: 'REJECTED' },
        }),
        this.prismaService.propertyReview.count({
          where: { status: 'REJECTED' },
        }),
      ]),

      // Transactions over the last 12 months for monthly chart
      this.prismaService.paymentTransaction.findMany({
        where: {
          status: 'SUCCESS',
          createdAt: { gte: twelveMonthsAgo },
        },
        select: {
          amount: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // 2. Sum moderation totals
    const pendingModeration = pendingCounts.reduce(
      (sum, count) => sum + count,
      0,
    );
    const totalApproved = approvedCounts.reduce((sum, count) => sum + count, 0);
    const totalRejected = rejectedCounts.reduce((sum, count) => sum + count, 0);

    // 3. Group transactions cleanly by month using Intl.DateTimeFormat
    const monthlyMap = new Map<
      string,
      { month: string; revenue: number; transactions: number }
    >();
    const monthFormatter = new Intl.DateTimeFormat('ar-EG', { month: 'long' });

    for (const t of recentTransactions) {
      const monthName = monthFormatter.format(t.createdAt);
      const existing = monthlyMap.get(monthName) ?? {
        month: monthName,
        revenue: 0,
        transactions: 0,
      };
      existing.revenue += t.amount;
      existing.transactions += 1;
      monthlyMap.set(monthName, existing);
    }

    return {
      summary: {
        totalRevenue: revenueAggregate._sum.amount ?? 0,
        totalTransactions: revenueAggregate._count._all,
        activeListings: activeListingsCount,
        pendingModeration,
      },
      monthlyRevenue: Array.from(monthlyMap.values()),
      moderationDistribution: [
        { label: 'تمت الموافقة', value: totalApproved },
        { label: 'قيد المراجعة', value: pendingModeration },
        { label: 'تم الرفض', value: totalRejected },
      ],
    };
  }
}
