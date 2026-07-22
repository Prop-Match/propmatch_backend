import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { PropertySearchQueryDto } from './dto/property-search-query.dto';
import {
  transformPropertyToDetail,
  transformPropertyToSummary,
} from './mappers/property.mapper';
import { RealtimeService } from '../realtime/realtime.service';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import { ChromaPropertyService } from './chroma-property.service';
import { PropertyEmbeddingService } from './property-embedding.service';
import { SemanticPropertySearchDto } from './dto/semantic-property-search.dto';

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly embeddingService?: PropertyEmbeddingService,
    private readonly chromaService?: ChromaPropertyService,
  ) {}

  private static readonly DETAIL_INCLUDE = {
    propertyImages: {
      orderBy: { displayOrder: 'asc' as const },
    },
    owner: {
      select: {
        fullName: true,
        phoneNumber: true,
        // Included so the mapper can derive ownerVerified without an extra query.
        identityVerification: { select: { status: true } },
      },
    },
    governorate: true,
    city: true,
    country: true,
  };

  /**
   * Hybrid search (PRO-11) — the tenant browse endpoint.
   *
   * Hard SQL filters (city / type / rent range / min bedrooms / furnished) are
   * the WHERE clause here. `q` is the semantic half: a naive case-insensitive
   * text match today, to be replaced by Samer's ChromaDB embedding ranking.
   *
   * Returns SUMMARIES only — no owner phone / name / address. Contact is gated
   * behind an ACCEPTED offer / CONNECTED match and is never exposed on browse.
   */
  async search(query: SearchPropertiesDto) {
    const where: Prisma.PropertyWhereInput = { status: 'APPROVED' };

    if (query.city) {
      where.city = { nameEn: { equals: query.city, mode: 'insensitive' as const } };
    }
    if (query.propertyType) where.propertyType = query.propertyType;
    if (query.bedrooms !== undefined) where.bedrooms = { gte: query.bedrooms };
    if (query.isFurnished) where.isFurnished = true;
    if (query.minRent !== undefined || query.maxRent !== undefined) {
      where.rentAmount = {
        ...(query.minRent !== undefined ? { gte: query.minRent } : {}),
        ...(query.maxRent !== undefined ? { lte: query.maxRent } : {}),
      };
    }

    const q = query.q?.trim();
    if (q) {
      try {
        if (!this.embeddingService || !this.chromaService) throw new Error();
        const vector = await this.embeddingService.createEmbedding(q);
        const matches = await this.chromaService.query({ embedding: vector, limit: 20 });
        const ids = matches.map((match) => match.propertyId);
        where.id = { in: ids };
      } catch {
        // Local semantic search is optional during development. Fall back to
        // the existing safe text search if the sidecar is not running.
        where.OR = [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { district: { contains: q, mode: 'insensitive' } },
          { propertyAroundServices: { contains: q, mode: 'insensitive' } },
        ];
      }
    }

    const properties = await this.prisma.property.findMany({
      where,
      include: PropertiesService.DETAIL_INCLUDE,
      // Boosted listings first (PRO-14), then newest.
      orderBy: [{ isBoosted: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });

    // Summary mapper omits all PII (phone/name/address) — only ownerVerified
    // is derived from the owner relation, so nothing sensitive is serialised.
    const items = properties.map(transformPropertyToSummary);
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  async semanticSearch(query: SemanticPropertySearchDto) {
    try {
      if (!this.embeddingService || !this.chromaService) {
        throw new Error('semantic search dependencies unavailable');
      }
      const embedding = await this.embeddingService.createEmbedding(query.query);
      const matches = await this.chromaService.query({
        embedding,
        limit: query.limit,
      });
      const orderedIds = [
        ...new Set(
          matches
            .filter(
              (match) =>
                typeof match.propertyId === 'string' &&
                match.propertyId.length > 0 &&
                match.vectorId === `property:${match.propertyId}`,
            )
            .map((match) => match.propertyId),
        ),
      ];
      if (orderedIds.length === 0) {
        return { items: [], total: 0, page: 1, pageSize: query.limit };
      }

      const properties = await this.prisma.property.findMany({
        where: { id: { in: orderedIds }, status: 'APPROVED' },
        include: PropertiesService.DETAIL_INCLUDE,
      });
      const byId = new Map(properties.map((property) => [property.id, property]));
      const items = orderedIds
        .map((id) => byId.get(id))
        .filter((property): property is NonNullable<typeof property> => Boolean(property))
        .map(transformPropertyToSummary);

      return { items, total: items.length, page: 1, pageSize: query.limit };
    } catch (error) {
      this.logger.error('semantic property search unavailable');
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'SEMANTIC_SEARCH_UNAVAILABLE',
        message: 'Semantic property search is temporarily unavailable.',
      });
    }
  }

  /**
   * Create a new property listing.
   *
   * Business rules (mirrors the mock router / SRS):
   *  1. Owner verification is enforced by VerifiedGuard.
   *  2. Owner must have freeListingsLeft > 0 in their quota.
   *  3. Property starts in PENDING status — admin must approve.
   *  4. First image in the array becomes the cover image.
   *  5. Quota is decremented after successful creation.
   */
  async create(ownerId: string, dto: CreatePropertyDto) {
    // ── 1. Quota gate ─────────────────────────────────────────────────
    const quota = await this.prisma.userQuota.findUnique({
      where: { userId: ownerId },
    });

    if (!quota || quota.freeListingsLeft <= 0) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'QUOTA_EXHAUSTED',
        message: 'انتهت محاولاتك المجانية',
        trigger: 'payment',
        paymentType: 'NEW_LISTING',
        priceEgp: 100,
      });
    }

    const dbGov = await this.prisma.governorate.findFirst({
      where: {
        OR: [
          { nameEn: { equals: dto.governorate, mode: 'insensitive' as const } },
          { nameAr: { equals: dto.governorate, mode: 'insensitive' as const } },
        ],
      },
    });

    const dbCity = await this.prisma.city.findFirst({
      where: {
        OR: [
          { nameEn: { equals: dto.city, mode: 'insensitive' as const } },
          { nameAr: { equals: dto.city, mode: 'insensitive' as const } },
        ],
      },
    });

    if (!dbGov || !dbCity) {
      throw new ForbiddenException('Selected region is not supported.');
    }

    if (!dbGov.status || !dbCity.status) {
      throw new ForbiddenException('Selected region is disabled.');
    }

    // ── 3. Create property + images + decrement quota in a transaction ─
    const result = await this.prisma.$transaction(async (tx) => {
      const property = await tx.property.create({
        data: {
          ownerId,
          title: dto.title,
          description: dto.description,
          countryId: dbGov.countryId,
          governorateId: dbGov.id,
          cityId: dbCity.id,
          district: dto.district,
          manualAddress: dto.manualAddress,
          propertyType: dto.propertyType,
          propertyAroundServices: dto.propertyAroundServices ?? null,
          rentAmount: dto.rentAmount,
          areaM2: dto.areaM2,
          bedrooms: dto.bedrooms,
          bathrooms: dto.bathrooms,
          isFurnished: dto.isFurnished,
          hasElevator: dto.hasElevator,
          hasParking: dto.hasParking,
          // status defaults to PENDING via Prisma schema
        },
      });

      // Create property images — first image is the cover
      if (dto.images.length > 0) {
        await tx.propertyImage.createMany({
          data: dto.images.map((imageUrl, index) => ({
            propertyId: property.id,
            imageUrl,
            displayOrder: index,
            isCover: index === 0,
          })),
        });
      }

      this.realtimeService.propertySubmitted(property);

      // Decrement the free listing quota
      await tx.userQuota.update({
        where: { userId: ownerId },
        data: { freeListingsLeft: { decrement: 1 } },
      });

      return property;
    });

    // ── 4. Return the full property detail ─────────────────────────────
    const property = await this.prisma.property.findUniqueOrThrow({
      where: { id: result.id },
      include: PropertiesService.DETAIL_INCLUDE,
    });

    return {
      property: transformPropertyToDetail(property, {
        contactRevealed: true, // owner always sees their own contact info
      }),
    };
  }

  /**
   * GET /properties — public browse (PRO-11).
   *
   * Never carries owner PII: list cards use the summary mapper, which has no
   * contact fields at all (see property.mapper.ts).
   */
  async getAll(query: PropertySearchQueryDto) {
    const where: Prisma.PropertyWhereInput = {
      status: 'APPROVED',
      ...(query.city ? { city: { nameEn: { equals: query.city, mode: 'insensitive' as const } } } : {}),
      ...(query.propertyType ? { propertyType: query.propertyType } : {}),
      ...(query.bedrooms !== undefined ? { bedrooms: query.bedrooms } : {}),
      ...(query.isFurnished !== undefined
        ? { isFurnished: query.isFurnished }
        : {}),
      ...(query.minRent !== undefined || query.maxRent !== undefined
        ? {
            rentAmount: {
              ...(query.minRent !== undefined ? { gte: query.minRent } : {}),
              ...(query.maxRent !== undefined ? { lte: query.maxRent } : {}),
            },
          }
        : {}),
      ...(query.q
        ? { title: { contains: query.q, mode: 'insensitive' as const } }
        : {}),
    };

    const [properties, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        include: PropertiesService.DETAIL_INCLUDE,
      }),
      this.prisma.property.count({ where }),
    ]);

    return {
      items: properties.map(transformPropertyToSummary),
      total,
    };
  }

  /**
   * GET /landlord/properties — the authenticated landlord's own listings.
   * Summary shape is enough for their management list; the create/detail
   * flow already returns the full detail with contact revealed.
   */
  async getMyProperties(ownerId: string) {
    const [properties, total] = await Promise.all([
      this.prisma.property.findMany({
        where: { ownerId },
        include: PropertiesService.DETAIL_INCLUDE,
      }),
      this.prisma.property.count({ where: { ownerId } }),
    ]);

    return {
      items: properties.map(transformPropertyToSummary),
      total,
    };
  }

  /**
   * GET /properties/:id.
   *
   * PII gate (rbac.md): contact info is per-connection, not per-property —
   * revealed only to the property's own owner, or a tenant with an ACCEPTED
   * offer on this property.
   */
  async getPropertyById(id: string, viewer?: { userId: string; role: string }) {
    const property = await this.prisma.property.findUniqueOrThrow({
      where: { id },
      include: PropertiesService.DETAIL_INCLUDE,
    });

    let contactRevealed = false;
    if (viewer?.userId === property.ownerId) {
      contactRevealed = true;
    } else if (viewer) {
      const acceptedOffer = await this.prisma.ownerOffer.findFirst({
        where: {
          propertyId: id,
          status: 'ACCEPTED',
          tenantRequest: { tenantId: viewer.userId },
        },
      });
      contactRevealed = acceptedOffer !== null;
    }

    return transformPropertyToDetail(property, { contactRevealed });
  }

  async getPendingProperties() {
    const properties = await this.prisma.property.findMany({
      where: {
        status: 'PENDING',
      },
      include: PropertiesService.DETAIL_INCLUDE,
    });

    return properties.map((p) => {
      return transformPropertyToDetail(p, {
        contactRevealed: true,
      });
    });
  }
}
