import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  FREE_ACTIVE_LISTING_LIMIT,
  PREMIUM_ACTIVE_LISTING_LIMIT,
  PRICING_CATALOG,
} from '../payments/pricing.catalog';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyMultipartDto } from './dto/update-property-multipart.dto';
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
import {
  DEFAULT_SEMANTIC_MIN_SIMILARITY,
  SemanticMatchingConfig,
} from '../config/semantic-matching.config';
import {
  SemanticPropertySearchItem,
  SemanticPropertySearchResponse,
} from './dto/semantic-property-search-response.dto';
import {
  buildSemanticMatchReasons,
  detectFurnishingPreference,
  detectPropertyTypePreference,
  propertyLocationMatches,
} from './semantic-match-reasons';

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly embeddingService?: PropertyEmbeddingService,
    private readonly chromaService?: ChromaPropertyService,
    private readonly semanticMatchingConfig?: SemanticMatchingConfig,
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
      where.city = {
        nameEn: { equals: query.city, mode: 'insensitive' as const },
      };
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
        const vector = await this.embeddingService.createPrimaryEmbedding(
          q,
          'search_query',
        );
        const matches = await this.chromaService.query({
          provider: vector.provider,
          embedding: vector.embedding,
          limit: 20,
        });
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
    const items = properties.map((p) => transformPropertyToSummary(p));
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  async semanticSearch(
    query: SemanticPropertySearchDto,
  ): Promise<SemanticPropertySearchResponse> {
    try {
      if (!this.embeddingService || !this.chromaService) {
        throw new Error('semantic search dependencies unavailable');
      }
      const vector = await this.embeddingService.createPrimaryEmbedding(
        query.query,
        'search_query',
      );
      const matches = await this.chromaService.query({
        provider: vector.provider,
        embedding: vector.embedding,
        // Retrieve bounded recall candidates once. Explicit facts detected in
        // the free-text query are applied after hydration; broad queries still
        // use the configured semantic threshold below.
        limit: 20,
      });
      const minSimilarity =
        this.semanticMatchingConfig?.minSimilarity ??
        DEFAULT_SEMANTIC_MIN_SIMILARITY;
      const seenIds = new Set<string>();
      const semanticMatches = matches.flatMap((match) => {
        if (
          typeof match.propertyId !== 'string' ||
          match.propertyId.length === 0 ||
          match.vectorId !== `property:${match.propertyId}` ||
          typeof match.distance !== 'number' ||
          !Number.isFinite(match.distance)
        ) {
          return [];
        }

        const cosineSimilarity = 1 - match.distance;
        if (
          cosineSimilarity < -1 ||
          cosineSimilarity > 1 ||
          seenIds.has(match.propertyId)
        ) {
          return [];
        }

        seenIds.add(match.propertyId);
        return [
          {
            propertyId: match.propertyId,
            semanticSimilarity: Number(cosineSimilarity.toFixed(4)),
          },
        ];
      });
      if (semanticMatches.length === 0) {
        return this.noRelevantSemanticMatch(query.limit);
      }

      const orderedIds = semanticMatches.map((match) => match.propertyId);

      const properties = await this.prisma.property.findMany({
        where: { id: { in: orderedIds }, status: 'APPROVED' },
        include: PropertiesService.DETAIL_INCLUDE,
      });
      const byId = new Map(
        properties.map((property) => [property.id, property]),
      );
      const furnishingPreference = detectFurnishingPreference(query.query);
      const propertyTypePreference = detectPropertyTypePreference(query.query);
      const locationConstraintDetected = properties.some((property) =>
        propertyLocationMatches(query.query, property),
      );
      const hasExplicitConstraint =
        furnishingPreference !== undefined ||
        propertyTypePreference !== undefined ||
        locationConstraintDetected;
      const items: SemanticPropertySearchItem[] = semanticMatches.flatMap(
        ({ propertyId, semanticSimilarity }) => {
          const property = byId.get(propertyId);
          if (!property) return [];
          if (
            furnishingPreference !== undefined &&
            property.isFurnished !== furnishingPreference
          ) {
            return [];
          }
          if (
            propertyTypePreference !== undefined &&
            property.propertyType !== propertyTypePreference
          ) {
            return [];
          }
          if (
            locationConstraintDetected &&
            !propertyLocationMatches(query.query, property)
          ) {
            return [];
          }
          if (!hasExplicitConstraint && semanticSimilarity < minSimilarity) {
            return [];
          }
          return property
            ? [
                {
                  ...transformPropertyToSummary(property),
                  semanticSimilarity,
                  matchReasons: buildSemanticMatchReasons(
                    query.query,
                    property,
                  ),
                },
              ]
            : [];
        },
      );

      const limitedItems = items.slice(0, query.limit);
      return limitedItems.length > 0
        ? {
            items: limitedItems,
            total: limitedItems.length,
            resultCount: limitedItems.length,
            page: 1,
            pageSize: query.limit,
          }
        : this.noRelevantSemanticMatch(query.limit);
    } catch (error) {
      this.logger.error('semantic property search unavailable');
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'SEMANTIC_SEARCH_UNAVAILABLE',
        message: 'Semantic property search is temporarily unavailable.',
      });
    }
  }

  private noRelevantSemanticMatch(
    pageSize: number,
  ): SemanticPropertySearchResponse {
    return {
      items: [],
      total: 0,
      resultCount: 0,
      page: 1,
      pageSize,
      reason: 'NO_RELEVANT_SEMANTIC_MATCH',
    };
  }

  /**
   * Create a new property listing.
   *
   * Business rules (mirrors the mock router / SRS):
   *  1. Owner verification is enforced by VerifiedGuard.
   *  2. Free owners may have one active unit; Premium owners may have five.
   *  3. Property starts in PENDING status — admin must approve.
   *  4. First image in the array becomes the cover image.
   */
  async create(ownerId: string, dto: CreatePropertyDto) {
    // ── 1. Server-authoritative active-unit gate ───────────────────────
    const quota = await this.prisma.userQuota.findUnique({
      where: { userId: ownerId },
    });
    const premiumActive =
      quota?.planType === 'PREMIUM' &&
      quota.planExpiresAt !== null &&
      quota.planExpiresAt.getTime() > Date.now();
    const activeUnitLimit = premiumActive
      ? PREMIUM_ACTIVE_LISTING_LIMIT
      : FREE_ACTIVE_LISTING_LIMIT;
    const activeUnitCount = await this.prisma.property.count({
      where: {
        ownerId,
        status: { in: ['PENDING', 'APPROVED'] },
      },
    });

    if (activeUnitCount >= activeUnitLimit) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PLAN_LIMIT_REACHED',
        message: 'وصلت إلى الحد الأقصى للوحدات النشطة في خطتك',
        trigger: 'payment',
        paymentType: 'PREMIUM_OWNER',
        priceEgp: PRICING_CATALOG.PREMIUM_OWNER.priceEgp,
        activeUnitCount,
        activeUnitLimit,
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

    // ── 3. Create property + images in a transaction ──────────────────
    const result = await this.prisma.$transaction(
      async (tx) => {
        const currentActiveUnitCount = await tx.property.count({
          where: {
            ownerId,
            status: { in: ['PENDING', 'APPROVED'] },
          },
        });
        if (currentActiveUnitCount >= activeUnitLimit) {
          throw new ForbiddenException({
            statusCode: 403,
            code: 'PLAN_LIMIT_REACHED',
            message: 'وصلت إلى الحد الأقصى للوحدات النشطة في خطتك',
            trigger: 'payment',
            paymentType: 'PREMIUM_OWNER',
            priceEgp: PRICING_CATALOG.PREMIUM_OWNER.priceEgp,
            activeUnitCount: currentActiveUnitCount,
            activeUnitLimit,
          });
        }

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

        return property;
      },
      { isolationLevel: 'Serializable' },
    );

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
      ...(query.city
        ? {
            city: {
              nameEn: { equals: query.city, mode: 'insensitive' as const },
            },
          }
        : {}),
      ...(query.propertyType ? { propertyType: query.propertyType } : {}),
      // Frontend sends bedrooms as "N+" (a minimum), so match >= N, not exact.
      ...(query.bedrooms !== undefined
        ? { bedrooms: { gte: query.bedrooms } }
        : {}),
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
      // Free-text `q` searches across the fields a tenant would expect, not
      // just the title (matches the frontend hybrid-search contract).
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' as const } },
              {
                description: {
                  contains: query.q,
                  mode: 'insensitive' as const,
                },
              },
              { district: { contains: query.q, mode: 'insensitive' as const } },
              {
                propertyAroundServices: {
                  contains: query.q,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };

    const [properties, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        include: PropertiesService.DETAIL_INCLUDE,
        // Boosted listings first (PRO-14 monetization), then newest.
        orderBy: [{ isBoosted: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.property.count({ where }),
    ]);

    return {
      items: properties.map((p) => transformPropertyToSummary(p)),
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
        // Archived listings remain available to their owner for management.
        where: { ownerId },
        include: PropertiesService.DETAIL_INCLUDE,
      }),
      this.prisma.property.count({
        where: { ownerId },
      }),
    ]);

    return {
      items: properties.map((p) => transformPropertyToSummary(p)),
      total,
    };
  }

  /** Confirm the property exists and belongs to this landlord, or throw 404. */
  private async requireOwnedProperty(ownerId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ownerId },
      select: { id: true, status: true },
    });
    if (!property) throw new NotFoundException('العقار غير موجود');
    return property;
  }

  /**
   * PRO-14 — boost a listing. Boosting is always a paid action (no free tier),
   * so this returns the coded paywall the frontend turns into the BOOST_LISTING
   * PaymentSheet. The isBoosted flip happens on payment success.
   */
  async boost(ownerId: string, propertyId: string) {
    await this.requireOwnedProperty(ownerId, propertyId);
    throw new ForbiddenException({
      statusCode: 403,
      code: 'QUOTA_EXHAUSTED',
      message: 'ترقية الإعلان تتطلب دفعًا',
      trigger: 'payment',
      paymentType: 'BOOST_LISTING',
      priceEgp: 75,
    });
  }

  /** Soft-archive a listing (ERD: never delete). */
  async archive(ownerId: string, propertyId: string) {
    await this.requireOwnedProperty(ownerId, propertyId);
    const property = await this.prisma.property.update({
      where: { id: propertyId },
      data: { status: 'ARCHIVED' },
      include: PropertiesService.DETAIL_INCLUDE,
    });
    return {
      property: transformPropertyToDetail(property, { contactRevealed: true }),
    };
  }

  /** Restore an owner listing into moderation; never republish it directly. */
  async unarchive(ownerId: string, propertyId: string) {
    await this.requireOwnedProperty(ownerId, propertyId);
    const property = await this.prisma.property.update({
      where: { id: propertyId },
      data: {
        status: 'PENDING',
        isBoosted: false,
        boostedUntil: null,
        approvedBy: null,
      },
      include: PropertiesService.DETAIL_INCLUDE,
    });
    if (property.approvedAt) {
      this.realtimeService.propertyEdited(property);
    } else {
      this.realtimeService.propertySubmitted(property);
    }
    return {
      property: transformPropertyToDetail(property, { contactRevealed: true }),
    };
  }

  /**
   * Replace a landlord's editable property data and submit it for moderation.
   * `approvedAt` is intentionally retained: it distinguishes edits from brand
   * new submissions in the admin queues without a schema migration.
   */
  async update(
    ownerId: string,
    propertyId: string,
    dto: UpdatePropertyMultipartDto,
    uploadedImageUrls: string[],
  ) {
    const existing = await this.prisma.property.findFirst({
      where: { id: propertyId, ownerId },
      include: { propertyImages: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!existing) throw new NotFoundException('العقار غير موجود');
    if (existing.status === 'ARCHIVED') {
      throw new ForbiddenException('لا يمكن تعديل عقار مؤرشف');
    }

    const retainedIds = [...new Set(dto.existingImageIds)];
    if (retainedIds.length !== dto.existingImageIds.length) {
      throw new BadRequestException('قائمة الصور الحالية غير صالحة');
    }
    const existingById = new Map(
      existing.propertyImages.map((image) => [image.id, image]),
    );
    if (retainedIds.some((id) => !existingById.has(id))) {
      throw new BadRequestException('إحدى الصور لا تنتمي إلى هذا العقار');
    }
    const totalImages = retainedIds.length + uploadedImageUrls.length;
    if (totalImages < 1) {
      throw new BadRequestException('أضف صورة واحدة على الأقل');
    }
    if (totalImages > 10) {
      throw new BadRequestException('يمكنك إضافة 10 صور كحد أقصى');
    }

    const [dbGov, dbCity] = await Promise.all([
      this.prisma.governorate.findFirst({
        where: {
          OR: [
            {
              nameEn: {
                equals: dto.governorate,
                mode: 'insensitive' as const,
              },
            },
            {
              nameAr: {
                equals: dto.governorate,
                mode: 'insensitive' as const,
              },
            },
          ],
        },
      }),
      this.prisma.city.findFirst({
        where: {
          OR: [
            { nameEn: { equals: dto.city, mode: 'insensitive' as const } },
            { nameAr: { equals: dto.city, mode: 'insensitive' as const } },
          ],
        },
      }),
    ]);
    if (!dbGov || !dbCity || dbCity.governorateId !== dbGov.id) {
      throw new ForbiddenException('Selected region is not supported.');
    }
    if (!dbGov.status || !dbCity.status) {
      throw new ForbiddenException('Selected region is disabled.');
    }

    const removedImages = existing.propertyImages.filter(
      (image) => !retainedIds.includes(image.id),
    );

    const updated = await this.prisma.$transaction(
      async (tx) => {
        // A rejected listing becoming active again must still respect the
        // owner's current plan capacity.
        if (!['PENDING', 'APPROVED'].includes(existing.status)) {
          const quota = await tx.userQuota.findUnique({
            where: { userId: ownerId },
          });
          const premiumActive =
            quota?.planType === 'PREMIUM' &&
            quota.planExpiresAt !== null &&
            quota.planExpiresAt.getTime() > Date.now();
          const activeUnitLimit = premiumActive
            ? PREMIUM_ACTIVE_LISTING_LIMIT
            : FREE_ACTIVE_LISTING_LIMIT;
          const activeUnitCount = await tx.property.count({
            where: {
              ownerId,
              id: { not: propertyId },
              status: { in: ['PENDING', 'APPROVED'] },
            },
          });
          if (activeUnitCount >= activeUnitLimit) {
            throw new ForbiddenException({
              statusCode: 403,
              code: 'PLAN_LIMIT_REACHED',
              message: 'وصلت إلى الحد الأقصى للوحدات النشطة في خطتك',
              trigger: 'payment',
              paymentType: 'PREMIUM_OWNER',
              priceEgp: PRICING_CATALOG.PREMIUM_OWNER.priceEgp,
              activeUnitCount,
              activeUnitLimit,
            });
          }
        }

        if (removedImages.length > 0) {
          await tx.propertyImage.deleteMany({
            where: { id: { in: removedImages.map((image) => image.id) } },
          });
        }
        await Promise.all(
          retainedIds.map((id, index) =>
            tx.propertyImage.update({
              where: { id },
              data: { displayOrder: index, isCover: index === 0 },
            }),
          ),
        );
        if (uploadedImageUrls.length > 0) {
          await tx.propertyImage.createMany({
            data: uploadedImageUrls.map((imageUrl, index) => ({
              propertyId,
              imageUrl,
              displayOrder: retainedIds.length + index,
              isCover: retainedIds.length === 0 && index === 0,
            })),
          });
        }

        return tx.property.update({
          where: { id: propertyId },
          data: {
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
            status: 'PENDING',
            approvedBy: null,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    if (existing.approvedAt) {
      this.realtimeService.propertyEdited(updated);
    } else {
      this.realtimeService.propertySubmitted(updated);
    }

    const property = await this.prisma.property.findUniqueOrThrow({
      where: { id: propertyId },
      include: PropertiesService.DETAIL_INCLUDE,
    });
    return {
      response: {
        property: transformPropertyToDetail(property, {
          contactRevealed: true,
        }),
      },
      removedImageUrls: removedImages.map((image) => image.imageUrl),
    };
  }

  /**
   * ERD-safe delete: archive instead of destroying the property and its
   * related offers, reviews, matches, and images.
   */
  async remove(ownerId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ownerId },
      select: { id: true, status: true },
    });
    if (!property) throw new NotFoundException('العقار غير موجود');
    if (property.status === 'ARCHIVED') {
      return { ok: true, status: 'ARCHIVED' as const };
    }

    await this.prisma.property.update({
      where: { id: propertyId },
      data: {
        status: 'ARCHIVED',
        isBoosted: false,
        boostedUntil: null,
        approvedBy: null,
      },
    });
    return { ok: true, status: 'ARCHIVED' as const };
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

    const isAdmin = viewer?.role === 'ADMIN';
    const isOwner = viewer?.userId === property.ownerId;
    if (
      (property.status === 'ARCHIVED' && !isOwner && !isAdmin) ||
      (property.status !== 'APPROVED' && !isOwner && !isAdmin)
    ) {
      throw new NotFoundException('العقار غير موجود');
    }

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

  async getAllTenantRequests() {
    const requests = await this.prisma.tenantRequest.findMany({
      where: { status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { ownerOffers: true },
        },
      },
    });
    return {
      items: requests.map((r) => ({
        id: r.id,
        minBudget: r.minBudget,
        maxBudget: r.maxBudget,
        preferredLocations: r.preferredLocations,
        propertyType: r.propertyType,
        requiredBedrooms: r.requiredBedrooms,
        needsFurnished: r.needsFurnished,
        flexibilityScore: r.flexibilityScore,
        lifestyleRequirements: r.lifestyleRequirements,
        offersCount: r._count?.ownerOffers ?? 0,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
