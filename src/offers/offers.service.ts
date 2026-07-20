import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { transformPropertyToSummary } from '../properties/mappers/property.mapper';
import { CreateOfferDto } from './dto/create-offer.dto';

/**
 * PRO-12/13 — the landlord side of the reverse marketplace: send an offer
 * against an approved tenant request, and list the offers you've sent.
 *
 * Sending costs one `freeOffersLeft`; when the quota is gone the frontend gets
 * a coded 403 and opens the OFFER_PACK paywall. On success the tenant is
 * notified live via the Week-1 realtime engine.
 */
@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Property include that satisfies the summary mapper (no PII is emitted). */
  private static readonly PROPERTY_SUMMARY_INCLUDE = {
    propertyImages: { orderBy: { displayOrder: 'asc' as const } },
    owner: {
      select: {
        fullName: true,
        phoneNumber: true,
        identityVerification: { select: { status: true } },
      },
    },
  };

  async sendOffer(landlordId: string, dto: CreateOfferDto) {
    // ── 1. Quota gate ────────────────────────────────────────────────────
    const quota = await this.prisma.userQuota.findUnique({
      where: { userId: landlordId },
    });
    if (!quota || quota.freeOffersLeft <= 0) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'QUOTA_EXHAUSTED',
        message: 'انتهت محاولاتك المجانية',
        trigger: 'payment',
        paymentType: 'OFFER_PACK',
        priceEgp: 50,
      });
    }

    // ── 2. The request must exist and be APPROVED ────────────────────────
    const request = await this.prisma.tenantRequest.findUnique({
      where: { id: dto.tenantRequestId },
    });
    if (!request || request.status !== 'APPROVED') {
      throw new NotFoundException('الطلب غير متاح');
    }

    // ── 3. The property must be this landlord's, and APPROVED ────────────
    const property = await this.prisma.property.findUnique({
      where: { id: dto.propertyId },
    });
    if (!property || property.ownerId !== landlordId) {
      throw new NotFoundException('العقار غير موجود');
    }
    if (property.status !== 'APPROVED') {
      throw new ForbiddenException('لا يمكن تقديم عرض بعقار غير معتمد');
    }

    // ── 4. One offer per landlord per request ────────────────────────────
    const existing = await this.prisma.ownerOffer.findFirst({
      where: { tenantRequestId: dto.tenantRequestId, ownerId: landlordId },
    });
    if (existing) {
      throw new ConflictException('قدّمت عرضًا على هذا الطلب بالفعل');
    }

    // ── 5. Create the offer and spend one quota, atomically ──────────────
    const offer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ownerOffer.create({
        data: {
          ownerId: landlordId,
          tenantRequestId: dto.tenantRequestId,
          propertyId: dto.propertyId,
          pitchMessage: dto.pitchMessage,
          proposedPrice: dto.proposedPrice,
          status: 'SENT',
        },
      });
      await tx.userQuota.update({
        where: { userId: landlordId },
        data: { freeOffersLeft: { decrement: 1 } },
      });
      return created;
    });

    // ── 6. Notify the tenant (persisted + pushed live) — Week-1 engine ───
    // The landlord's identity stays hidden; the tenant only sees "a new offer".
    await this.realtime.notifyUser(request.tenantId, {
      type: 'NEW_OFFER_RECEIVED',
      title: 'عرض جديد على طلبك',
      message: 'وصلك عرض جديد من أحد الملّاك — اطّلع عليه الآن.',
      link: '/tenant/offers',
    });

    return {
      id: offer.id,
      status: offer.status,
      freeOffersLeft: quota.freeOffersLeft - 1,
    };
  }

  /** GET /api/landlord/offers — the offers this landlord has sent. */
  async getSentOffers(landlordId: string) {
    const offers = await this.prisma.ownerOffer.findMany({
      where: { ownerId: landlordId },
      include: { property: { include: OffersService.PROPERTY_SUMMARY_INCLUDE } },
      orderBy: { createdAt: 'desc' },
    });

    // `property` is nullable in the schema (ERD "quick-add"); V1 always sets it,
    // but an offer with no property can't fill the frontend's SentOffer shape,
    // so skip it. flatMap narrows `offer.property` to non-null inside the block.
    const items = offers.flatMap((offer) => {
      if (!offer.property) return [];
      return [
        {
          id: offer.id,
          tenantRequestId: offer.tenantRequestId,
          property: transformPropertyToSummary(offer.property),
          pitchMessage: offer.pitchMessage,
          proposedPrice: offer.proposedPrice,
          status: offer.status,
          createdAt: offer.createdAt.toISOString(),
        },
      ];
    });
    return { items };
  }
}
