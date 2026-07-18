import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { transformPropertyToDetail } from './mappers/property.mapper';

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Prisma include used whenever we need the full property detail. */
  private static readonly DETAIL_INCLUDE = {
    propertyImages: {
      orderBy: { displayOrder: 'asc' as const },
    },
    owner: {
      select: {
        fullName: true,
        phoneNumber: true,
      },
    },
  };

  /**
   * Create a new property listing.
   *
   * Business rules (mirrors the mock router / SRS):
   *  1. Owner must have an APPROVED identity verification.
   *  2. Owner must have freeListingsLeft > 0 in their quota.
   *  3. Property starts in PENDING status — admin must approve.
   *  4. First image in the array becomes the cover image.
   *  5. Quota is decremented after successful creation.
   */
  async create(ownerId: string, dto: CreatePropertyDto) {
    // ── 1. Verification gate ──────────────────────────────────────────
    const verification = await this.prisma.identityVerification.findUnique({
      where: { userId: ownerId },
    });

    if (!verification || verification.status !== 'APPROVED') {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'VERIFICATION_REQUIRED',
        message: 'وثّق هويتك أولًا لإتمام هذا الإجراء',
      });
    }

    // ── 2. Quota gate ─────────────────────────────────────────────────
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
        ownerVerified: true, // already checked verification above
        contactRevealed: true, // owner always sees their own contact info
      }),
    };
  }
}
