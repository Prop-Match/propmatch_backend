import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { PropertySearchQueryDto } from './dto/property-search-query.dto';
import {
  transformPropertyToDetail,
  transformPropertyToSummary,
} from './mappers/property.mapper';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

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

  /**
   * GET /properties — public browse (PRO-11).
   *
   * Never carries owner PII: list cards use the summary mapper, which has no
   * contact fields at all (see property.mapper.ts).
   */
  async getAll(query: PropertySearchQueryDto) {
    const where: Prisma.PropertyWhereInput = {
      status: 'APPROVED',
      ...(query.city ? { city: query.city } : {}),
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
