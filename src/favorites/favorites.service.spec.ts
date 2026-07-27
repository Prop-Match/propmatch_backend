import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { FavoritesService } from './favorites.service';

describe('FavoritesService', () => {
  let service: FavoritesService;
  let prismaMock: {
    favorite: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      deleteMany: jest.Mock;
    };
    property: {
      findUnique: jest.Mock;
    };
  };

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockPropertyId = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    prismaMock = {
      favorite: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      property: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FavoritesService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<FavoritesService>(FavoritesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFavorites', () => {
    it('should return mapped property summaries for tenant favorites', async () => {
      prismaMock.favorite.findMany.mockResolvedValue([
        {
          id: 'fav-1',
          tenantId: mockTenantId,
          propertyId: mockPropertyId,
          createdAt: new Date(),
          property: {
            id: mockPropertyId,
            title: 'شقة فاخرة',
            district: 'المعادي',
            propertyType: 'APARTMENT',
            rentAmount: 5000,
            areaM2: 120,
            bedrooms: 2,
            bathrooms: 1,
            isFurnished: true,
            isBoosted: false,
            status: 'APPROVED',
            propertyImages: [
              { id: 'img-1', imageUrl: 'http://example.com/img.jpg', displayOrder: 0, isCover: true },
            ],
            governorate: { nameAr: 'القاهرة', nameEn: 'Cairo' },
            city: { nameAr: 'المعادي', nameEn: 'Maadi' },
            owner: {
              fullName: 'أحمد علي',
              phoneNumber: '01000000000',
              identityVerification: { status: 'APPROVED' },
            },
          },
        },
      ]);

      const result = await service.getFavorites(mockTenantId);
      expect(result).toHaveProperty('items');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(mockPropertyId);
      expect(result.items[0].title).toBe('شقة فاخرة');
    });
  });

  describe('addFavorite', () => {
    it('should throw NotFoundException if property does not exist', async () => {
      prismaMock.property.findUnique.mockResolvedValue(null);

      await expect(
        service.addFavorite(mockTenantId, { propertyId: mockPropertyId }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should add favorite if property exists and not already favorited', async () => {
      prismaMock.property.findUnique.mockResolvedValue({ id: mockPropertyId });
      prismaMock.favorite.findUnique.mockResolvedValue(null);
      prismaMock.favorite.create.mockResolvedValue({
        id: 'fav-1',
        tenantId: mockTenantId,
        propertyId: mockPropertyId,
      });

      const result = await service.addFavorite(mockTenantId, { propertyId: mockPropertyId });
      expect(result).toEqual({ favorited: true });
      expect(prismaMock.favorite.create).toHaveBeenCalledWith({
        data: {
          tenantId: mockTenantId,
          propertyId: mockPropertyId,
        },
      });
    });

    it('should return favorited: true without duplicate create if already favorited', async () => {
      prismaMock.property.findUnique.mockResolvedValue({ id: mockPropertyId });
      prismaMock.favorite.findUnique.mockResolvedValue({
        id: 'fav-1',
        tenantId: mockTenantId,
        propertyId: mockPropertyId,
      });

      const result = await service.addFavorite(mockTenantId, { propertyId: mockPropertyId });
      expect(result).toEqual({ favorited: true });
      expect(prismaMock.favorite.create).not.toHaveBeenCalled();
    });
  });

  describe('removeFavorite', () => {
    it('should delete favorite record and return favorited: false', async () => {
      prismaMock.favorite.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.removeFavorite(mockTenantId, mockPropertyId);
      expect(result).toEqual({ favorited: false });
      expect(prismaMock.favorite.deleteMany).toHaveBeenCalledWith({
        where: {
          tenantId: mockTenantId,
          propertyId: mockPropertyId,
        },
      });
    });
  });
});
