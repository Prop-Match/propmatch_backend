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
import * as crypto from 'crypto';
import { I18nContext } from 'nestjs-i18n';
import { Cron, CronExpression } from '@nestjs/schedule';
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
import { MailService } from '../mail/mail.service';
import { PrismaService } from './../../prisma/prisma.service';
import { RealtimeService } from './../realtime/realtime.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ReviewDecisionDto } from './dto/review-decision.dto';
import { AdminStats } from './interfaces/admin-stats.interface';

const KYC_DOCUMENT_READ_TTL_SECONDS = 300;
const ANONYMIZATION_GRACE_PERIOD_DAYS = 30;
const ANONYMIZATION_BATCH_SIZE = 20;
const ANONYMIZATION_BATCH_DELAY_MS = 1000;

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
    private readonly mailService: MailService,
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
    deletedAt?: Date | null;
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
      // Soft-delete/anonymization state — orthogonal to suspension below (see
      // the User.deletedAt schema comment): a deleted account is a "ghost"
      // with its own reactivation flow, a suspended one is still live.
      deletedAt: u.deletedAt ? u.deletedAt.toISOString() : null,
      suspended,
      suspendedUntil: suspended
        ? (u.suspendedUntil?.toISOString() ?? null)
        : null,
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

  /**
   * GET /admin/users — paginated, searchable list of non-admin users, shared
   * by both the suspension console (search + suspend/unsuspend) and the
   * Active/Suspended-Deleted tabs (status filter). `status` defaults to
   * 'active' (deletedAt: null) so the main view stays clean — ghosted/
   * anonymized accounts (see AdminService.anonymizeExpiredUsers) don't
   * clutter it by default — while still letting an admin explicitly switch
   * to the deleted tab via ?status=deleted. Every row carries both the
   * deletion and suspension state (toUserRow), since the two are orthogonal
   * account states an admin may need to see together.
   */
  async listUsers(
    query: {
      status?: 'active' | 'deleted' | 'all';
      search?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const status = query.status ?? 'active';
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20));
    const search = query.search?.trim();
    const where = {
      role: { not: 'ADMIN' as const },
      ...(status === 'deleted'
        ? { deletedAt: { not: null } }
        : status === 'all'
          ? {}
          : { deletedAt: null }),
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
      deletedAt: true,
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
  async suspendUser(
    actorId: string,
    targetUserId: string,
    dto: SuspendUserDto,
  ) {
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
    await this.mailService.sendAccountSuspendedEmail({
      to: updated.email,
      name: updated.fullName,
      reason:
        SUSPENSION_REASONS[dto.reason] ??
        updated.suspensionReason ??
        dto.reason,
      note: updated.suspensionNote ?? undefined,
      suspendedUntil: updated.suspendedUntil?.toISOString(),
    });
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
    await this.mailService.sendAccountUnsuspendedEmail({
      to: updated.email,
      name: updated.fullName,
    });
    return this.toUserRow(updated);
  }

  private commercialPriority(
    quota?: {
      planType: 'FREE' | 'OWNER_PLUS' | 'PREMIUM';
      planExpiresAt: Date | null;
    } | null,
  ) {
    const active = quota?.planExpiresAt && quota.planExpiresAt > new Date();
    if (active && quota.planType === 'PREMIUM') return 'PREMIUM' as const;
    if (active && quota.planType === 'OWNER_PLUS') return 'OWNER_PLUS' as const;
    return 'FREEMIUM' as const;
  }

  private sortCommercialQueue<
    T extends { submittedAt: string; commercialPriority: string },
  >(items: T[]): T[] {
    const tierWeight: Record<string, number> = {
      PREMIUM: 200,
      OWNER_PLUS: 100,
      FREEMIUM: 0,
    };
    return items.sort((a, b) => {
      const ageScore = (item: T) =>
        Math.floor((Date.now() - Date.parse(item.submittedAt)) / 86_400_000) *
        20;
      return (
        tierWeight[b.commercialPriority] +
          ageScore(b) -
          (tierWeight[a.commercialPriority] + ageScore(a)) ||
        Date.parse(a.submittedAt) - Date.parse(b.submittedAt)
      );
    });
  }

  async getQueues() {
    const [kyc, properties, editedProperties, requests, reviews] =
      await Promise.all([
        this.prismaService.identityVerification.findMany({
          where: { status: 'PENDING' },
          include: { user: { include: { userQuota: true } } },
          orderBy: { submittedAt: 'desc' },
        }),
        this.prismaService.property.findMany({
          where: { status: 'PENDING', approvedAt: null },
          include: { owner: { include: { userQuota: true } } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prismaService.property.findMany({
          where: { status: 'PENDING', approvedAt: { not: null } },
          include: { owner: { include: { userQuota: true } } },
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
      kycQueue: this.sortCommercialQueue(
        kyc.map((k) => ({
          id: `q_kyc_${k.id}`,
          type: 'kyc',
          subjectId: k.userId,
          title: k.user.fullName,
          subtitle: k.user.email,
          submittedAt: k.submittedAt.toISOString(),
          commercialPriority: this.commercialPriority(k.user.userQuota),
        })),
      ),
      propertyQueue: this.sortCommercialQueue(
        properties.map((p) => ({
          id: `q_prop_${p.id}`,
          type: 'property',
          subjectId: p.id,
          title: p.title,
          subtitle: `Rent Amount: EGP ${p.rentAmount}`,
          submittedAt: p.createdAt.toISOString(),
          commercialPriority: this.commercialPriority(p.owner?.userQuota),
        })),
      ),
      editedPropertyQueue: this.sortCommercialQueue(
        editedProperties.map((p) => ({
          id: `q_prop_edit_${p.id}`,
          type: 'propertyEdit',
          subjectId: p.id,
          title: p.title,
          subtitle: `تم تعديل الإعلان · الإيجار: ${p.rentAmount} ج.م`,
          submittedAt: p.updatedAt.toISOString(),
          commercialPriority: this.commercialPriority(p.owner?.userQuota),
        })),
      ),
      requestQueue: requests.map((r) => ({
        id: `q_req_${r.id}`,
        type: 'request',
        subjectId: r.id,
        title: `Request for ${r.propertyType}`,
        subtitle: `Budget: EGP ${r.minBudget} - ${r.maxBudget}`,
        submittedAt: r.createdAt.toISOString(),
        commercialPriority: 'FREEMIUM' as const,
      })),
      reviewQueue: reviews.map((rev) => ({
        id: `q_rev_${rev.id}`,
        type: 'review',
        subjectId: rev.id,
        title: `Review on ${rev.property.title} by ${rev.reviewer.fullName}`,
        subtitle: `Rating: ${rev.rating}/5. ${rev.comment ?? ''}`,
        submittedAt: rev.createdAt.toISOString(),
        commercialPriority: 'FREEMIUM' as const,
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
      include: { user: { select: { email: true, fullName: true } } },
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
    await this.realtimeService.notifyUser(userId, {
      type: isApproved
        ? NotificationType.EKYC_APPROVED
        : NotificationType.EKYC_RESUBMISSION_REQUIRED,
      title:
        I18nContext.current()?.t(
          isApproved ? 'admin.TITLE_KYC_APPROVED' : 'admin.TITLE_KYC_REJECTED',
        ) ||
        (isApproved ? 'تم قبول توثيق الهوية' : 'مطلوب تصحيح مستندات التوثيق'),
      message:
        I18nContext.current()?.t(
          isApproved ? 'admin.MSG_KYC_APPROVED' : 'admin.MSG_KYC_REJECTED',
          { args: { reason: reviewDecisionDto.reason } },
        ) ||
        (isApproved
          ? 'تمت الموافقة على توثيق هويتك بنجاح.'
          : `يرجى تصحيح المستندات وإعادة تقديمها. السبب: ${reviewDecisionDto.reason ?? ''}`),
      link: '/profile',
    });
    await this.mailService.sendKycReviewEmail({
      to: v.user.email,
      name: v.user.fullName,
      approved: isApproved,
      reason: reviewDecisionDto.reason,
    });
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
      include: { owner: { select: { email: true, fullName: true } } },
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
      type: isApproved ? 'PROPERTY_APPROVED' : 'PROPERTY_REJECTED',
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
    await this.mailService.sendPropertyReviewEmail({
      to: p.owner.email,
      name: p.owner.fullName,
      approved: isApproved,
      propertyId: property.id,
      propertyTitle: property.title,
      reason: reviewDecisionDto.reason,
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
      include: { tenant: { select: { email: true, fullName: true } } },
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
      type: isApproved ? 'TENANT_REQUEST_APPROVED' : 'TENANT_REQUEST_REJECTED',
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
    await this.mailService.sendTenantRequestReviewEmail({
      to: r.tenant.email,
      name: r.tenant.fullName,
      approved: isApproved,
      reason: reviewDecisionDto.reason,
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
      include: { reviewer: { select: { email: true, fullName: true } } },
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
      type: isApproved ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
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
    await this.mailService.sendUserReviewDecisionEmail({
      to: ur.reviewer.email,
      name: ur.reviewer.fullName,
      approved: isApproved,
      propertyId: userReview.propertyId,
      reason: reviewDecisionDto.reason,
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
    await this.mailService.sendAdminWelcomeEmail({
      to: admin.email,
      name: admin.fullName,
      roleLabel: roleLabelFor(admin.adminRole),
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
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        adminRole: true,
        isActive: true,
      },
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
      target.isActive &&
      capabilitiesFor(target.adminRole).includes('admin:manage');
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
    await this.audit(actorId, 'admin:update', id);
    await this.mailService.sendAdminAccountUpdatedEmail({
      to: admin.email,
      name: admin.fullName,
      roleLabel: roleLabelFor(admin.adminRole),
      disabled: !admin.isActive,
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

  async resetAdminPassword(actorId: string, id: string) {
    const admin = await this.prismaService.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true },
    });
    if (!admin || admin.role !== 'ADMIN') {
      throw new NotFoundException('المشرف غير موجود');
    }
    const rawToken = crypto.randomBytes(32).toString('hex');
    const resetToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    await this.prismaService.user.update({
      where: { id },
      data: {
        resetToken,
        resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await this.audit(actorId, 'admin:reset-password', id);
    await this.mailService.sendPasswordResetEmail(admin.email, rawToken);
    return { sent: true };
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

  /**
   * Soft-deletes a platform account (DELETE /admin/users/:id). Sets
   * `deletedAt` and archives everything that would otherwise keep surfacing
   * this user's activity to others — their own TenantRequests (so the
   * matching pool stops considering them) and, if they're a landlord, their
   * Properties (so their listings stop appearing in browse/search). All
   * three writes are one transaction: a landlord with 40 properties must
   * never end up half-deleted if the process dies partway through.
   *
   * This does not touch existing MatchConnections, Messages, or
   * PaymentTransactions — deleting those would corrupt the other party's
   * conversation history and the platform's financial audit trail. The user
   * becomes inert (can't log in, stops appearing as an active landlord/
   * tenant); their historical footprint stays intact by design.
   */
  async softDeleteUser(adminId: string, userId: string) {
    const target = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        deletedAt: true,
        adminRole: true,
      },
    });
    if (!target) throw new NotFoundException('المستخدم غير موجود');
    if (target.deletedAt) {
      throw new ConflictException('تم حذف هذا المستخدم بالفعل');
    }
    if (target.role === 'ADMIN') {
      // Deleting admin accounts is a distinct, higher-stakes action (it
      // should go through team-offboarding, not the generic user-delete
      // button) — out of scope here, refuse rather than silently allow it.
      throw new ForbiddenException(
        'لا يمكن حذف حسابات المشرفين من هنا — استخدم إدارة الفريق',
      );
    }
    if (target.id === adminId) {
      throw new ForbiddenException('لا يمكنك حذف حسابك الخاص');
    }

    await this.prismaService.$transaction([
      this.prismaService.user.update({
        where: { id: userId },
        data: { deletedAt: new Date() },
      }),
      this.prismaService.tenantRequest.updateMany({
        where: { tenantId: userId, status: { notIn: ['ARCHIVED'] } },
        data: { status: 'ARCHIVED' },
      }),
      this.prismaService.property.updateMany({
        where: { ownerId: userId, status: { not: 'ARCHIVED' } },
        data: { status: 'ARCHIVED' },
      }),
    ]);

    await this.audit(adminId, 'user:delete', userId);

    // Passive invalidation (JwtStrategy/gateway middleware checking
    // deletedAt) only blocks the user on their *next* request/reconnect —
    // if they're already connected, kick the live socket now so a currently
    // active session doesn't keep working until it happens to refresh.
    this.realtimeService.forceLogoutUser(userId);
    await this.mailService.sendAccountDeletedEmail({
      to: target.email,
      name: target.fullName,
    });

    return { success: true, id: userId };
  }

  /** GET /admin/reactivations — pending self-service reactivation requests. */
  async listReactivationRequests() {
    const requests = await this.prismaService.activationRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { fullName: true, email: true, deletedAt: true } },
      },
    });
    return {
      items: requests.map((r) => ({
        id: r.id,
        userId: r.userId,
        userFullName: r.user.fullName,
        userEmail: r.user.email,
        deletedAt: r.user.deletedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * POST /admin/reactivations/:id/approve. Restores the account and bumps
   * tokenVersion (revokes any lingering pre-deletion token — see
   * JwtStrategy). Deliberately does NOT touch the user's ARCHIVED
   * TenantRequests/Properties or enqueue the matching worker: reactivation
   * restores the account, not its listings — the user re-publishes each one
   * manually, on their own schedule, exactly as the business rule specifies.
   */
  async approveReactivation(adminId: string, requestId: string) {
    const request = await this.prismaService.activationRequest.findUnique({
      where: { id: requestId },
      include: { user: { select: { fullName: true, email: true } } },
    });
    if (!request) throw new NotFoundException('طلب إعادة التفعيل غير موجود');
    if (request.status !== 'PENDING') {
      throw new ConflictException('تمت مراجعة هذا الطلب بالفعل');
    }

    await this.prismaService.$transaction([
      this.prismaService.user.update({
        where: { id: request.userId },
        data: { deletedAt: null, tokenVersion: { increment: 1 } },
      }),
      this.prismaService.activationRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED' },
      }),
    ]);

    await this.audit(adminId, 'user:reactivate:approve', request.userId);

    await this.realtimeService.notifyUser(request.userId, {
      type: 'ACCOUNT_REACTIVATED',
      title: 'تمت إعادة تفعيل حسابك',
      message: 'وافق أحد المشرفين على طلبك بإعادة تفعيل حسابك.',
      link: '/login',
    });
    await this.mailService.sendAccountReactivatedEmail(
      request.user.email,
      request.user.fullName,
    );

    return { success: true, id: requestId };
  }

  /** POST /admin/reactivations/:id/reject. */
  async rejectReactivation(adminId: string, requestId: string) {
    const request = await this.prismaService.activationRequest.findUnique({
      where: { id: requestId },
      include: { user: { select: { fullName: true, email: true } } },
    });
    if (!request) throw new NotFoundException('طلب إعادة التفعيل غير موجود');
    if (request.status !== 'PENDING') {
      throw new ConflictException('تمت مراجعة هذا الطلب بالفعل');
    }

    await this.prismaService.activationRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED' },
    });

    await this.audit(adminId, 'user:reactivate:reject', request.userId);

    await this.realtimeService.notifyUser(request.userId, {
      type: 'ACCOUNT_REACTIVATION_REJECTED',
      title: 'طلب إعادة التفعيل',
      message: 'راجع أحد المشرفين طلبك ولم تتم الموافقة عليه في الوقت الحالي.',
      link: null,
    });
    await this.mailService.sendAccountReactivationRejectedEmail(
      request.user.email,
      request.user.fullName,
    );

    return { success: true, id: requestId };
  }

  /**
   * Daily at midnight — anonymizes accounts that have sat soft-deleted past
   * the 30-day grace period. This replaced a literal hard `user.delete()`:
   * most of this schema's relations to User use Prisma's default
   * onDelete: Restrict, not Cascade, so a real delete would foreign-key-fail
   * for any user who ever sent a message, made an offer, left a review, etc.
   * — effectively every real account — and even where cascading could be
   * forced, it would destroy other parties' history (e.g. cascading through
   * MatchConnection would wipe the *other* tenant/landlord's chat).
   *
   * Anonymization sidesteps all of that: the row and its id stay intact, so
   * every relation (Messages, Offers, Properties, Requests) stays unbroken,
   * and the user becomes an unreachable "ghost". PII fields are scrubbed:
   * name becomes a placeholder, email is scrambled to a random, permanently
   * unique address (freeing the original email for a fresh signup),
   * password/phone are scrambled to unusable values (both columns are
   * non-nullable, so "nullify" isn't an option for them), and the reset-token
   * pair is cleared so a stale token can't be replayed against the ghost row.
   *
   * Batched deliberately, same as the previous implementation: fetching every
   * candidate up front and chunking it in memory (rather than repeatedly
   * re-querying `deletedAt < cutoff`) means a user whose update fails can
   * never cause an infinite loop. Promise.allSettled per batch means one
   * failure doesn't abort the rest of that batch, and the delay between
   * batches spreads the load instead of firing everything at Postgres at
   * once.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async anonymizeExpiredUsers(): Promise<void> {
    const cutoff = new Date(
      Date.now() - ANONYMIZATION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    );
    const candidates = await this.prismaService.user.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true },
    });
    if (candidates.length === 0) return;

    let anonymizedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < candidates.length; i += ANONYMIZATION_BATCH_SIZE) {
      const batch = candidates.slice(i, i + ANONYMIZATION_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((u) =>
          this.prismaService.user.update({
            where: { id: u.id },
            data: {
              fullName: 'Deleted User',
              email: `deleted-${crypto.randomUUID()}@propmatch.local`,
              passwordHash: bcrypt.hashSync(crypto.randomUUID(), 10),
              phoneNumber: `deleted-${crypto.randomUUID()}`,
              avatarUrl: null,
              resetToken: null,
              resetTokenExpiry: null,
            },
          }),
        ),
      );
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') {
          anonymizedCount++;
        } else {
          failedCount++;
          this.logger.error(
            `Anonymization failed for user ${batch[index].id}: ${
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)
            }`,
          );
        }
      }
      const isLastBatch = i + ANONYMIZATION_BATCH_SIZE >= candidates.length;
      if (!isLastBatch) {
        await new Promise((resolve) =>
          setTimeout(resolve, ANONYMIZATION_BATCH_DELAY_MS),
        );
      }
    }

    this.logger.log(
      `Anonymization cron: ${anonymizedCount} anonymized, ${failedCount} failed (of ${candidates.length} candidates past the ${ANONYMIZATION_GRACE_PERIOD_DAYS}-day grace period).`,
    );
  }
}
