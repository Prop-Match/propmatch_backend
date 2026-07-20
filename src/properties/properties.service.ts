import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import {
  transformPropertyToDetail,
  transformPropertyToSummary,
} from './mappers/property.mapper';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(private readonly prisma: PrismaService, private readonly realtimeService: RealtimeService) {}

  /** Prisma include used whenever we need the full property detail. */
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

    if (query.city) where.city = query.city;
    if (query.propertyType) where.propertyType = query.propertyType;
    if (query.bedrooms !== undefined) where.bedrooms = { gte: query.bedrooms };
    if (query.isFurnished) where.isFurnished = true;
    if (query.minRent !== undefined || query.maxRent !== undefined) {
      where.rentAmount = {
        ...(query.minRent !== undefined ? { gte: query.minRent } : {}),
        ...(query.maxRent !== undefined ? { lte: query.maxRent } : {}),
      };
    }

    // Semantic seam: until ChromaDB, match the free text across the searchable
    // fields. Replace this OR block with the vector-ranked id set later.
    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { district: { contains: q, mode: 'insensitive' } },
        { propertyAroundServices: { contains: q, mode: 'insensitive' } },
      ];
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

    // ── 3. Create property + images + decrement quota in a transaction ─
    const result = await this.prisma.$transaction(async (tx) => {
      const property = await tx.property.create({
        data: {
          ownerId,
          title: dto.title,
          description: dto.description,
          governorate: dto.governorate,
          city: dto.city,
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

  async getAll(){
    const properties = await this.prisma.property.findMany({
      where: {
        status: 'APPROVED',
      },
      include: PropertiesService.DETAIL_INCLUDE,
    });

    return properties.map((p) => {
      return transformPropertyToDetail(p, {
        contactRevealed: true,
      });
    });
  }

  async getPropertyById(id: string) {
    const property = await this.prisma.property.findUniqueOrThrow({
      where: { id },
      include: PropertiesService.DETAIL_INCLUDE,
    });

    return transformPropertyToDetail(property, {
      contactRevealed: true,
    });
  }

  async getPendingProperties(){
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
