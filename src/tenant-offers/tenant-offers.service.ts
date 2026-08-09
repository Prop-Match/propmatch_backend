import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { transformPropertyToSummary } from '../properties/mappers/property.mapper';
import type {
  CounterOfferDto,
  CreateTenantOfferDto,
} from './dto/tenant-offer.dto';
import { PropertyAnalyticsService } from '../property-analytics/property-analytics.service';

const PROPERTY_SUMMARY_INCLUDE = {
  propertyImages: { orderBy: { displayOrder: 'asc' as const } },
  owner: {
    select: {
      fullName: true,
      phoneNumber: true,
      identityVerification: { select: { status: true } },
    },
  },
  governorate: true,
  city: true,
  country: true,
};

// Direct interest on a specific listing ⇒ maximum intent.
const DIRECT_OFFER_MATCH_SCORE = 100;

/**
 * Forward-marketplace: tenants make priced offers directly on listings.
 * State machine: PENDING → (landlord) COUNTERED | ACCEPTED | DECLINED,
 * COUNTERED → (tenant) ACCEPTED | WITHDRAWN. ACCEPTED creates a CONNECTED
 * MatchConnection (contact reveal + chat), mirroring OwnerOffer acceptance.
 */
@Injectable()
export class TenantOffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Optional() private readonly analytics?: PropertyAnalyticsService,
  ) {}

  /** POST /tenant/listing-offers */
  async create(tenantId: string, dto: CreateTenantOfferDto) {
    const property = await this.prisma.property.findUnique({
      where: { id: dto.propertyId },
      select: { id: true, ownerId: true, status: true, title: true },
    });
    if (!property) throw new NotFoundException('العقار غير موجود');
    if (property.status !== 'APPROVED') {
      throw new ForbiddenException('لا يمكن تقديم عرض على عقار غير متاح');
    }
    if (property.ownerId === tenantId) {
      throw new ForbiddenException('لا يمكنك تقديم عرض على عقارك');
    }

    const active = await this.prisma.tenantOffer.findFirst({
      where: {
        tenantId,
        propertyId: dto.propertyId,
        status: { in: ['PENDING', 'COUNTERED'] },
      },
      select: { id: true },
    });
    if (active) {
      throw new ConflictException('لديك عرض قائم على هذا العقار بالفعل');
    }

    const offer = await this.prisma.tenantOffer.create({
      data: {
        tenantId,
        propertyId: dto.propertyId,
        ownerId: property.ownerId,
        message: dto.message,
        proposedPrice: dto.proposedPrice,
        status: 'PENDING',
      },
    });
    await this.analytics?.recordCounter(dto.propertyId, 'tenantOffers');

    await this.realtime.notifyUser(property.ownerId, {
      type: 'NEW_OFFER_RECEIVED',
      title: 'عرض جديد على عقارك',
      message: `قدّم مستأجر عرضاً بقيمة ${dto.proposedPrice} ج.م على "${property.title}"`,
      link: '/landlord/offers?tab=received',
    });

    return {
      id: offer.id,
      status: offer.status,
      proposedPrice: offer.proposedPrice,
      message: offer.message,
      createdAt: offer.createdAt.toISOString(),
    };
  }

  /** GET /tenant/listing-offers */
  async listForTenant(tenantId: string) {
    const offers = await this.prisma.tenantOffer.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      include: { property: { include: PROPERTY_SUMMARY_INCLUDE } },
    });
    return {
      items: offers.map((o) => ({
        id: o.id,
        status: o.status,
        proposedPrice: o.proposedPrice,
        counterPrice: o.counterPrice,
        counterMessage: o.counterMessage,
        message: o.message,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
        property: transformPropertyToSummary(o.property),
      })),
    };
  }

  /** GET /landlord/listing-offers */
  async listForLandlord(ownerId: string) {
    const offers = await this.prisma.tenantOffer.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
      include: {
        property: { include: PROPERTY_SUMMARY_INCLUDE },
        tenant: { select: { fullName: true } },
      },
    });
    return {
      items: offers.map((o) => ({
        id: o.id,
        status: o.status,
        proposedPrice: o.proposedPrice,
        counterPrice: o.counterPrice,
        counterMessage: o.counterMessage,
        message: o.message,
        tenantName: o.tenant.fullName,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
        property: transformPropertyToSummary(o.property),
      })),
    };
  }

  /** POST /landlord/listing-offers/:id/accept — landlord accepts the tenant's price. */
  async landlordAccept(ownerId: string, offerId: string) {
    const offer = await this.requireOffer(offerId, { ownerId });
    if (offer.status !== 'PENDING') {
      throw new ConflictException('لا يمكن قبول هذا العرض في حالته الحالية');
    }
    return this.settleAsMatch(offer.id, offer.proposedPrice, 'tenant');
  }

  /** POST /landlord/listing-offers/:id/decline */
  async landlordDecline(ownerId: string, offerId: string) {
    const offer = await this.requireOffer(offerId, { ownerId });
    if (offer.status !== 'PENDING' && offer.status !== 'COUNTERED') {
      throw new ConflictException('لا يمكن رفض هذا العرض في حالته الحالية');
    }
    await this.prisma.tenantOffer.update({
      where: { id: offerId },
      data: { status: 'DECLINED' },
    });
    await this.realtime.notifyUser(offer.tenantId, {
      type: 'NEW_OFFER_RECEIVED',
      title: 'تم رفض عرضك',
      message: 'اعتذر المالك عن قبول عرضك على العقار.',
      link: '/tenant/offers?tab=sent',
    });
    return { id: offerId, status: 'DECLINED' as const };
  }

  /** POST /landlord/listing-offers/:id/counter */
  async landlordCounter(
    ownerId: string,
    offerId: string,
    dto: CounterOfferDto,
  ) {
    const offer = await this.requireOffer(offerId, { ownerId });
    if (offer.status !== 'PENDING') {
      throw new ConflictException('لا يمكن تقديم عرض مضاد في هذه الحالة');
    }
    await this.prisma.tenantOffer.update({
      where: { id: offerId },
      data: {
        status: 'COUNTERED',
        counterPrice: dto.counterPrice,
        counterMessage: dto.counterMessage ?? null,
      },
    });
    await this.realtime.notifyUser(offer.tenantId, {
      type: 'NEW_OFFER_RECEIVED',
      title: 'عرض مضاد من المالك',
      message: `اقترح المالك إيجاراً بقيمة ${dto.counterPrice} ج.م.`,
      link: '/tenant/offers?tab=sent',
    });
    return {
      id: offerId,
      status: 'COUNTERED' as const,
      counterPrice: dto.counterPrice,
    };
  }

  /** POST /tenant/listing-offers/:id/accept — tenant accepts the landlord's counter. */
  async tenantAccept(tenantId: string, offerId: string) {
    const offer = await this.requireOffer(offerId, { tenantId });
    if (offer.status !== 'COUNTERED') {
      throw new ConflictException('لا يوجد عرض مضاد لقبوله');
    }
    return this.settleAsMatch(
      offer.id,
      offer.counterPrice ?? offer.proposedPrice,
      'owner',
    );
  }

  /** POST /tenant/listing-offers/:id/withdraw */
  async tenantWithdraw(tenantId: string, offerId: string) {
    const offer = await this.requireOffer(offerId, { tenantId });
    if (offer.status !== 'PENDING' && offer.status !== 'COUNTERED') {
      throw new ConflictException('لا يمكن سحب هذا العرض في حالته الحالية');
    }
    await this.prisma.tenantOffer.update({
      where: { id: offerId },
      data: { status: 'WITHDRAWN' },
    });
    return { id: offerId, status: 'WITHDRAWN' as const };
  }

  // --- helpers ---

  private async requireOffer(
    offerId: string,
    scope: { ownerId?: string; tenantId?: string },
  ) {
    const offer = await this.prisma.tenantOffer.findFirst({
      where: { id: offerId, ...scope },
    });
    if (!offer) throw new NotFoundException('العرض غير موجود');
    return offer;
  }

  /**
   * Accept terminal transition shared by both sides: mark ACCEPTED, ensure the
   * listing is still available, create a CONNECTED MatchConnection, notify the
   * counterparty. `notify` is who to notify ('tenant' = landlord accepted).
   */
  private async settleAsMatch(
    offerId: string,
    agreedPrice: number,
    notify: 'tenant' | 'owner',
  ) {
    const offer = await this.prisma.tenantOffer.findUniqueOrThrow({
      where: { id: offerId },
    });
    const property = await this.prisma.property.findUnique({
      where: { id: offer.propertyId },
    });
    if (!property || property.status !== 'APPROVED') {
      throw new ForbiddenException('العقار لم يعد متاحاً');
    }

    const connection = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.tenantOffer.updateMany({
        where: { id: offerId, status: { in: ['PENDING', 'COUNTERED'] } },
        data: { status: 'ACCEPTED' },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('لم يعد من الممكن قبول هذا العرض');
      }
      // Reuse an existing connection if the pair already messaged; else create.
      const existing = await tx.matchConnection.findFirst({
        where: {
          tenantId: offer.tenantId,
          propertyId: offer.propertyId,
          ownerId: offer.ownerId,
          tenantRequestId: null,
        },
      });
      if (existing) {
        return tx.matchConnection.update({
          where: { id: existing.id },
          data: { status: 'CONNECTED' },
        });
      }
      return tx.matchConnection.create({
        data: {
          tenantId: offer.tenantId,
          propertyId: offer.propertyId,
          ownerId: offer.ownerId,
          matchScore: DIRECT_OFFER_MATCH_SCORE,
          status: 'CONNECTED',
        },
      });
    });

    await this.analytics?.recordCounter(offer.propertyId, 'matches');

    const recipientId = notify === 'tenant' ? offer.tenantId : offer.ownerId;
    await this.realtime.notifyUser(recipientId, {
      type: 'NEW_MATCH',
      title: 'تم قبول العرض 🎉',
      message: `تم قبول العرض بقيمة ${agreedPrice} ج.م. يمكنكما الآن مناقشة التفاصيل.`,
      link:
        notify === 'tenant'
          ? '/tenant/offers?tab=sent'
          : '/landlord/offers?tab=received',
    });

    return {
      id: offerId,
      status: 'ACCEPTED' as const,
      agreedPrice,
      matchConnectionId: connection.id,
    };
  }
}
