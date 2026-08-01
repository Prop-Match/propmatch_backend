import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Property, TenantRequest } from 'generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { transformPropertyToSummary } from '../properties/mappers/property.mapper';
import { SemanticMatchingConfig } from '../config/semantic-matching.config';
import { buildHybridMatchReasons } from '../matching/hybrid-match-reasons.util';
import { cosineSimilarity } from '../matching/matching.math.util';
import { MatchReason } from './dto/match-reason.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import {
  combineHybridScore,
  scoreRequestAgainstProperty,
} from './match-score.util';

/** Prisma include needed by transformPropertyToSummary. */
const PROPERTY_SUMMARY_INCLUDE = {
  propertyImages: { orderBy: { displayOrder: 'asc' as const } },
  owner: {
    select: {
      fullName: true,
      phoneNumber: true,
      identityVerification: { select: { status: true } },
    },
  },
};

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly semanticMatchingConfig: SemanticMatchingConfig,
  ) {}

  /**
   * Single source of truth for a (request, property) score — reused by every
   * matchScore/matchReasons site in this service so the UI card and
   * MatchingWorker's proactive-notification finalScore never diverge. Uses
   * the vectors MatchingWorker already persisted (TenantRequest.embedding,
   * Property.embedding) — pure local cosine similarity, no embedding call,
   * so this stays safe to run inline on a synchronous request path. Falls
   * back to rule-based-only (semanticSimilarity: null) until the request has
   * gone through at least one matching-queue run.
   */
  private computeHybridMatch(
    request: TenantRequest,
    property: Property,
  ): { score: number; reasons: MatchReason[] } {
    const ruleScore = scoreRequestAgainstProperty(request, property);
    const semanticSimilarity =
      request.embedding.length > 0 && property.embedding.length > 0
        ? cosineSimilarity(request.embedding, property.embedding)
        : null;
    const score = combineHybridScore(ruleScore, semanticSimilarity);
    const reasons = buildHybridMatchReasons(
      request,
      property,
      semanticSimilarity,
      this.semanticMatchingConfig.minSimilarity,
    );
    return { score, reasons };
  }

  /**
   * GET /landlord/requests â€” approved tenant requests, scored against this
   * landlord's own approved properties (PRO-13). Tenant identity never
   * appears here (rbac.md â€” hidden until an offer is accepted).
   */
  async browseRequests(landlordId: string) {
    const [myProperties, requests, myOfferedRequestIds] = await Promise.all([
      this.prisma.property.findMany({
        where: { ownerId: landlordId, status: 'APPROVED' },
      }),
      this.prisma.tenantRequest.findMany({ where: { status: 'APPROVED' } }),
      this.prisma.ownerOffer
        .findMany({
          where: { ownerId: landlordId },
          select: { tenantRequestId: true },
        })
        .then((rows) => new Set(rows.map((r) => r.tenantRequestId))),
    ]);

    const items = requests
      .map((request) => {
        const scored = myProperties.map((property) => ({
          property,
          ...this.computeHybridMatch(request, property),
        }));
        const best = scored.length
          ? scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0])
          : null;

        return {
          id: request.id,
          minBudget: request.minBudget,
          maxBudget: request.maxBudget,
          preferredLocations: request.preferredLocations,
          propertyType: request.propertyType,
          requiredBedrooms: request.requiredBedrooms,
          needsFurnished: request.needsFurnished,
          flexibilityScore: request.flexibilityScore,
          lifestyleRequirements: request.lifestyleRequirements,
          createdAt: request.createdAt.toISOString(),
          matchScore: best ? best.score : null,
          matchReasons: best ? best.reasons : [],
          alreadyOffered: myOfferedRequestIds.has(request.id),
          bestMatchingProperty: best
            ? { id: best.property.id, title: best.property.title }
            : null,
        };
      })
      .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));

    return { items };
  }

  /** GET /landlord/offers â€” offers this landlord has sent. */
  async getSentOffers(landlordId: string) {
    const offers = await this.prisma.ownerOffer.findMany({
      where: { ownerId: landlordId },
      include: {
        property: { include: PROPERTY_SUMMARY_INCLUDE },
        tenantRequest: {
          select: {
            tenantId: true,
            tenant: { select: { fullName: true, phoneNumber: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: await Promise.all(
        offers.map(async (o) => {
          const connection =
            o.status === 'ACCEPTED'
              ? await this.prisma.matchConnection.findFirst({
                  where: {
                    tenantId: o.tenantRequest.tenantId,
                    ownerId: landlordId,
                    propertyId: o.propertyId!,
                    status: 'CONNECTED',
                  },
                  select: { id: true },
                })
              : null;
          return {
            id: o.id,
            tenantRequestId: o.tenantRequestId,
            property: transformPropertyToSummary(o.property!),
            pitchMessage: o.pitchMessage,
            proposedPrice: o.proposedPrice,
            status: o.status,
            createdAt: o.createdAt.toISOString(),
            tenantName:
              o.status === 'ACCEPTED' ? o.tenantRequest.tenant.fullName : null,
            tenantPhoneNumber:
              o.status === 'ACCEPTED'
                ? o.tenantRequest.tenant.phoneNumber
                : null,
            matchConnectionId: connection?.id ?? null,
          };
        }),
      ),
    };
  }

  /** POST /landlord/offers â€” send an offer against an approved tenant request. */
  async createOffer(landlordId: string, dto: CreateOfferDto) {
    const quota = await this.prisma.userQuota.findUnique({
      where: { userId: landlordId },
    });
    const premiumActive =
      quota?.planType === 'PREMIUM' &&
      quota.planExpiresAt !== null &&
      quota.planExpiresAt.getTime() > Date.now();

    if (!premiumActive && (!quota || quota.freeOffersLeft <= 0)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'QUOTA_EXHAUSTED',
        message: 'انتهت عروضك المباشرة المجانية',
        trigger: 'payment',
        paymentType: 'PREMIUM_OWNER',
        priceEgp: 999,
      });
    }

    const request = await this.prisma.tenantRequest.findFirst({
      where: { id: dto.tenantRequestId, status: 'APPROVED' },
    });
    if (!request) throw new NotFoundException('Ø§Ù„Ø·Ù„Ø¨ ØºÙŠØ± Ù…ØªØ§Ø­');

    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, ownerId: landlordId },
    });
    if (!property)
      throw new NotFoundException('Ø§Ù„Ø¹Ù‚Ø§Ø± ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
    if (property.status !== 'APPROVED') {
      throw new ForbiddenException(
        'Ù„Ø§ ÙŠÙ…ÙƒÙ† ØªÙ‚Ø¯ÙŠÙ… Ø¹Ø±Ø¶ Ø¨Ø¹Ù‚Ø§Ø± ØºÙŠØ± Ù…Ø¹ØªÙ…Ø¯',
      );
    }

    const existing = await this.prisma.ownerOffer.findFirst({
      where: { tenantRequestId: dto.tenantRequestId, ownerId: landlordId },
    });
    if (existing)
      throw new ConflictException(
        'Ù‚Ø¯Ù‘Ù…Øª Ø¹Ø±Ø¶Ù‹Ø§ Ø¹Ù„Ù‰ Ù‡Ø°Ø§ Ø§Ù„Ø·Ù„Ø¨ Ø¨Ø§Ù„ÙØ¹Ù„',
      );

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
      if (!premiumActive) {
        const spent = await tx.userQuota.updateMany({
          where: { userId: landlordId, freeOffersLeft: { gt: 0 } },
          data: { freeOffersLeft: { decrement: 1 } },
        });
        if (spent.count !== 1) {
          throw new ForbiddenException({
            statusCode: 403,
            code: 'QUOTA_EXHAUSTED',
            message: 'انتهت عروضك المباشرة المجانية',
            trigger: 'payment',
            paymentType: 'PREMIUM_OWNER',
            priceEgp: 999,
          });
        }
      }
      return created;
    });

    await this.realtimeService.notifyUser(request.tenantId, {
      type: 'NEW_OFFER_RECEIVED',
      title: 'عرض جديد على طلبك',
      message: 'وصلك عرض جديد من أحد الملاك — اطّلع عليه الآن.',
      link: '/tenant/offers',
    });

    const updatedQuota = await this.prisma.userQuota.findUniqueOrThrow({
      where: { userId: landlordId },
    });

    return {
      id: offer.id,
      status: offer.status,
      freeOffersLeft: updatedQuota.freeOffersLeft,
    };
  }

  /** Shared projection for the tenant's offer inbox â€” PII gated on ACCEPTED. */
  private async toReceivedOffer(offer: {
    id: string;
    tenantRequestId: string;
    propertyId: string | null;
    pitchMessage: string;
    proposedPrice: number;
    status: string;
    ownerId: string;
    createdAt: Date;
  }) {
    const [property, request, owner] = await Promise.all([
      this.prisma.property.findUnique({
        where: { id: offer.propertyId! },
        include: PROPERTY_SUMMARY_INCLUDE,
      }),
      this.prisma.tenantRequest.findUnique({
        where: { id: offer.tenantRequestId },
      }),
      this.prisma.user.findUnique({
        where: { id: offer.ownerId },
        select: { fullName: true, phoneNumber: true },
      }),
    ]);
    const accepted = offer.status === 'ACCEPTED';
    const connection = accepted
      ? await this.prisma.matchConnection.findFirst({
          where: {
            tenantId: request?.tenantId,
            ownerId: offer.ownerId,
            propertyId: offer.propertyId!,
            status: 'CONNECTED',
          },
          select: { id: true },
        })
      : null;
    const hybrid = request ? this.computeHybridMatch(request, property!) : null;
    return {
      id: offer.id,
      tenantRequestId: offer.tenantRequestId,
      property: transformPropertyToSummary(property!),
      pitchMessage: offer.pitchMessage,
      proposedPrice: offer.proposedPrice,
      status: offer.status,
      matchScore: hybrid ? hybrid.score : null,
      matchReasons: hybrid ? hybrid.reasons : [],
      createdAt: offer.createdAt.toISOString(),
      ownerName: accepted ? (owner?.fullName ?? null) : null,
      ownerPhoneNumber: accepted ? (owner?.phoneNumber ?? null) : null,
      manualAddress: accepted ? (property?.manualAddress ?? null) : null,
      matchConnectionId: connection?.id ?? null,
    };
  }

  /** GET /tenant/offers â€” offers received against this tenant's own requests. */
  async getReceivedOffers(tenantId: string) {
    const offers = await this.prisma.ownerOffer.findMany({
      where: { tenantRequest: { tenantId } },
      orderBy: { createdAt: 'desc' },
    });

    const items = await Promise.all(offers.map((o) => this.toReceivedOffer(o)));
    items.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    return { items };
  }

  private async findOwnedOffer(tenantId: string, offerId: string) {
    const offer = await this.prisma.ownerOffer.findFirst({
      where: { id: offerId, tenantRequest: { tenantId } },
    });
    if (!offer) throw new NotFoundException('ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
    return offer;
  }

  /** POST /tenant/offers/:id/view â€” SENT â†’ VIEWED (ASSUMPTIONS #13). */
  async viewOffer(tenantId: string, offerId: string) {
    const offer = await this.findOwnedOffer(tenantId, offerId);
    if (offer.status === 'SENT') {
      await this.prisma.ownerOffer.update({
        where: { id: offerId },
        data: { status: 'VIEWED' },
      });
    }
    const updated = await this.prisma.ownerOffer.findUniqueOrThrow({
      where: { id: offerId },
    });
    return this.toReceivedOffer(updated);
  }

  /**
   * POST /tenant/offers/:id/accept â€” creates a CONNECTED match, fulfils the
   * request, and reveals both parties' contact info.
   */
  async acceptOffer(tenantId: string, offerId: string) {
    const offer = await this.findOwnedOffer(tenantId, offerId);
    if (offer.status !== 'SENT' && offer.status !== 'VIEWED')
      throw new ConflictException(
        'Offer cannot be accepted in its current state.',
      );
    const property = await this.prisma.property.findUnique({
      where: { id: offer.propertyId! },
    });
    if (!property || property.status !== 'APPROVED')
      throw new ForbiddenException('Property is no longer available.');
    const request = await this.prisma.tenantRequest.findUniqueOrThrow({
      where: { id: offer.tenantRequestId },
    });
    if (request.status !== 'APPROVED')
      throw new ConflictException('Tenant request is no longer available.');
    const owner = await this.prisma.user.findUniqueOrThrow({
      where: { id: offer.ownerId },
    });
    const { score: matchScore } = this.computeHybridMatch(request, property);
    const connection = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.tenantRequest.updateMany({
        where: { id: offer.tenantRequestId, status: 'APPROVED' },
        data: { status: 'FULFILLED' },
      });
      if (claimed.count !== 1)
        throw new ConflictException('Tenant request is no longer available.');
      const accepted = await tx.ownerOffer.updateMany({
        where: { id: offerId, status: { in: ['SENT', 'VIEWED'] } },
        data: { status: 'ACCEPTED' },
      });
      if (accepted.count !== 1)
        throw new ConflictException(
          'Offer cannot be accepted in its current state.',
        );
      await tx.ownerOffer.updateMany({
        where: {
          tenantRequestId: offer.tenantRequestId,
          id: { not: offerId },
          status: { in: ['SENT', 'VIEWED'] },
        },
        data: { status: 'REJECTED' },
      });
      return tx.matchConnection.create({
        data: {
          tenantId,
          propertyId: property.id,
          ownerId: offer.ownerId,
          matchScore,
          status: 'CONNECTED',
        },
      });
    });
    await this.realtimeService.notifyUser(offer.ownerId, {
      type: 'NEW_MATCH',
      title: 'Offer accepted',
      message: 'The tenant accepted your offer.',
      link: '/landlord/offers',
    });
    return {
      offerId: offer.id,
      status: 'ACCEPTED',
      ownerName: owner.fullName,
      ownerPhoneNumber: owner.phoneNumber,
      manualAddress: property.manualAddress,
      matchConnectionId: connection.id,
    };
  }

  /** POST /tenant/offers/:id/reject. */
  async rejectOffer(tenantId: string, offerId: string) {
    const offer = await this.findOwnedOffer(tenantId, offerId);
    if (offer.status !== 'SENT' && offer.status !== 'VIEWED')
      throw new ConflictException(
        'Offer cannot be rejected in its current state.',
      );
    const rejected = await this.prisma.ownerOffer.updateMany({
      where: { id: offerId, status: { in: ['SENT', 'VIEWED'] } },
      data: { status: 'REJECTED' },
    });
    if (rejected.count !== 1)
      throw new ConflictException(
        'Offer cannot be rejected in its current state.',
      );
    return { ok: true };
  }
}
