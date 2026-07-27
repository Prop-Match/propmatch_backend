import { PropertiesService } from './properties.service';

describe('PropertiesService.search', () => {
  const findMany = jest.fn();
  const service = new PropertiesService(
    { property: { findMany } } as never,
    {} as never,
  );

  beforeEach(() => {
    findMany.mockReset();
  });

  it('lists only approved properties with stable boosted/newest/id ordering', async () => {
    findMany.mockResolvedValue([
      {
        id: 'property-b',
        title: 'Safe listing',
        governorate: { nameAr: 'القاهرة', nameEn: 'Cairo' },
        city: { nameAr: 'القاهرة', nameEn: 'Cairo' },
        country: { nameAr: 'مصر', nameEn: 'Egypt' },
        district: 'Maadi',
        propertyType: 'APARTMENT',
        rentAmount: 12000,
        areaM2: 100,
        bedrooms: 2,
        bathrooms: 1,
        isFurnished: true,
        isBoosted: true,
        status: 'APPROVED',
        propertyImages: [
          {
            id: 'image-1',
            imageUrl: 'https://images.test/cover.jpg',
            displayOrder: 0,
            isCover: true,
          },
        ],
        owner: {
          fullName: 'Private owner',
          phoneNumber: '01000000000',
          identityVerification: { status: 'APPROVED' },
        },
      },
    ]);

    const result = await service.search({ city: 'Cairo', bedrooms: 2 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'APPROVED',
          city: { nameEn: { equals: 'Cairo', mode: 'insensitive' } },
          bedrooms: { gte: 2 },
        },
        orderBy: [{ isBoosted: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 'property-b',
          coverImage: 'https://images.test/cover.jpg',
          ownerVerified: true,
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 1,
    });
    expect(result.items[0]).not.toHaveProperty('ownerName');
    expect(result.items[0]).not.toHaveProperty('ownerPhoneNumber');
  });

  it('returns an HTTP-safe empty list shape when no approved properties match', async () => {
    findMany.mockResolvedValue([]);

    await expect(service.search({})).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 0,
    });
  });
});
