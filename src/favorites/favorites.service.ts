import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { transformPropertyToSummary } from '../properties/mappers/property.mapper';

/** Relations the summary mapper needs (mirrors PropertiesService.DETAIL_INCLUDE). */
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

/**
 * Tenant favorites (PRO — listings). Matches the frontend contract
 * (`src/mocks/router.ts` /tenant/favorites): list returns property summaries,
 * add/remove are idempotent and return the `favorited` flag.
 */
@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /tenant/favorites → the tenant's favorited properties as summaries. */
  async list(tenantId: string) {
    const favorites = await this.prisma.favorite.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { property: { include: PROPERTY_SUMMARY_INCLUDE } },
    });
    const items = favorites.map((f) => transformPropertyToSummary(f.property));
    return { items };
  }

  /** POST /tenant/favorites — idempotent add. */
  async add(tenantId: string, propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true },
    });
    if (!property) throw new NotFoundException('العقار غير موجود');

    await this.prisma.favorite.upsert({
      where: { tenantId_propertyId: { tenantId, propertyId } },
      update: {},
      create: { tenantId, propertyId },
    });
    return { favorited: true };
  }

  /** DELETE /tenant/favorites/:propertyId — idempotent remove. */
  async remove(tenantId: string, propertyId: string) {
    await this.prisma.favorite.deleteMany({ where: { tenantId, propertyId } });
    return { favorited: false };
  }
}
