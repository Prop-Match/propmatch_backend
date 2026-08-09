import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { transformPropertyToSummary } from '../properties/mappers/property.mapper';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { PropertyAnalyticsService } from '../property-analytics/property-analytics.service';

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly analytics?: PropertyAnalyticsService,
  ) {}

  /**
   * GET /tenant/favorites
   * Fetch all favorited properties for a given tenant.
   */
  async getFavorites(tenantId: string) {
    const favorites = await this.prisma.favorite.findMany({
      where: { tenantId },
      include: {
        property: {
          include: {
            propertyImages: {
              orderBy: { displayOrder: 'asc' },
            },
            governorate: true,
            city: true,
            owner: {
              select: {
                fullName: true,
                phoneNumber: true,
                identityVerification: { select: { status: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const items = favorites.map((fav) =>
      transformPropertyToSummary(fav.property),
    );
    return { items };
  }

  /**
   * POST /tenant/favorites
   * Add a property to tenant's favorites.
   */
  async addFavorite(tenantId: string, dto: CreateFavoriteDto) {
    const property = await this.prisma.property.findUnique({
      where: { id: dto.propertyId },
    });

    if (!property) {
      throw new NotFoundException('العقار غير موجود');
    }

    const existing = await this.prisma.favorite.findUnique({
      where: {
        tenantId_propertyId: {
          tenantId,
          propertyId: dto.propertyId,
        },
      },
    });

    if (!existing) {
      await this.prisma.favorite.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
        },
      });
      await this.analytics?.recordCounter(dto.propertyId, 'favoritesAdded');
    }

    return { favorited: true };
  }

  /**
   * DELETE /tenant/favorites/:propertyId
   * Remove a property from tenant's favorites.
   */
  async removeFavorite(tenantId: string, propertyId: string) {
    const removed = await this.prisma.favorite.deleteMany({
      where: {
        tenantId,
        propertyId,
      },
    });
    if (removed.count > 0) {
      await this.analytics?.recordCounter(propertyId, 'favoritesRemoved');
    }

    return { favorited: false };
  }
}
