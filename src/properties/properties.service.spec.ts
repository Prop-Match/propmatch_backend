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

describe('PropertiesService.update', () => {
  it('replaces editable fields, retains selected images, and returns the listing to review', async () => {
    const existing = {
      id: 'property-1',
      ownerId: 'owner-1',
      status: 'APPROVED',
      approvedAt: new Date('2026-07-20T12:00:00.000Z'),
      propertyImages: [
        {
          id: 'image-1',
          imageUrl: '/public/properties/keep.jpg',
          displayOrder: 0,
          isCover: true,
        },
        {
          id: 'image-2',
          imageUrl: '/public/properties/remove.jpg',
          displayOrder: 1,
          isCover: false,
        },
      ],
    };
    const detail = {
      ...existing,
      title: 'Updated property',
      description: 'A sufficiently detailed updated property description.',
      district: 'University district',
      manualAddress: 'Detailed street address',
      propertyType: 'APARTMENT',
      propertyAroundServices: 'University',
      rentAmount: 4500,
      areaM2: 100,
      bedrooms: 2,
      bathrooms: 1,
      isFurnished: false,
      hasElevator: true,
      hasParking: false,
      contactRevealed: false,
      isBoosted: false,
      boostedUntil: null,
      approvedBy: null,
      createdAt: new Date('2026-07-01T12:00:00.000Z'),
      updatedAt: new Date('2026-07-29T12:00:00.000Z'),
      governorateId: 1,
      cityId: 2,
      countryId: 1,
      governorate: { id: 1, nameAr: 'الدقهلية', nameEn: 'Dakahlia' },
      city: { id: 2, nameAr: 'المنصورة', nameEn: 'Mansoura' },
      country: { id: 1, nameAr: 'مصر', nameEn: 'Egypt' },
      owner: {
        fullName: 'Owner',
        phoneNumber: '01000000000',
        identityVerification: { status: 'APPROVED' },
      },
      propertyImages: [
        {
          id: 'image-1',
          propertyId: 'property-1',
          imageUrl: '/public/properties/keep.jpg',
          displayOrder: 0,
          isCover: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'image-3',
          propertyId: 'property-1',
          imageUrl: '/public/properties/new.jpg',
          displayOrder: 1,
          isCover: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };
    const propertyUpdate = jest.fn().mockResolvedValue(detail);
    const imageUpdate = jest.fn().mockResolvedValue({});
    const imageDeleteMany = jest.fn().mockResolvedValue({});
    const imageCreateMany = jest.fn().mockResolvedValue({});
    const propertyEdited = jest.fn();
    const prisma = {
      property: {
        findFirst: jest.fn().mockResolvedValue(existing),
        findUniqueOrThrow: jest.fn().mockResolvedValue(detail),
      },
      governorate: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          countryId: 1,
          status: true,
        }),
      },
      city: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 2, governorateId: 1, status: true }),
      },
      $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          property: { update: propertyUpdate },
          propertyImage: {
            update: imageUpdate,
            deleteMany: imageDeleteMany,
            createMany: imageCreateMany,
          },
        }),
    };
    const service = new PropertiesService(
      prisma as never,
      { propertyEdited, propertySubmitted: jest.fn() } as never,
    );

    const result = await service.update(
      'owner-1',
      'property-1',
      {
        title: 'Updated property',
        description: 'A sufficiently detailed updated property description.',
        governorate: 'الدقهلية',
        city: 'المنصورة',
        district: 'University district',
        manualAddress: 'Detailed street address',
        propertyType: 'APARTMENT',
        propertyAroundServices: 'University',
        rentAmount: 4500,
        areaM2: 100,
        bedrooms: 2,
        bathrooms: 1,
        isFurnished: false,
        hasElevator: true,
        hasParking: false,
        existingImageIds: ['image-1'],
      },
      ['/public/properties/new.jpg'],
    );

    expect(propertyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Updated property',
          status: 'PENDING',
          approvedBy: null,
        }),
      }),
    );
    expect(imageDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['image-2'] } },
    });
    expect(imageCreateMany).toHaveBeenCalled();
    expect(propertyEdited).toHaveBeenCalledWith(detail);
    expect(result.removedImageUrls).toEqual(['/public/properties/remove.jpg']);
    expect(result.response.property).toMatchObject({
      id: 'property-1',
      title: 'Updated property',
    });
  });
});

describe('PropertiesService.remove', () => {
  it('archives an owned property without deleting its row or images', async () => {
    const update = jest.fn().mockResolvedValue({});
    const service = new PropertiesService(
      {
        property: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'property-1', status: 'APPROVED' }),
          update,
        },
      } as never,
      {} as never,
    );

    await expect(service.remove('owner-1', 'property-1')).resolves.toEqual({
      ok: true,
      status: 'ARCHIVED',
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'property-1' },
      data: {
        status: 'ARCHIVED',
        isBoosted: false,
        boostedUntil: null,
        approvedBy: null,
      },
    });
  });

  it('does not reveal whether another landlord owns the property', async () => {
    const service = new PropertiesService(
      {
        property: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never,
      {} as never,
    );

    await expect(service.remove('owner-1', 'property-2')).rejects.toMatchObject(
      {
        status: 404,
      },
    );
  });
});

describe('PropertiesService.getPropertyById', () => {
  const archivedProperty = {
    id: 'property-1',
    ownerId: 'owner-1',
    title: 'Archived apartment',
    description: 'A detailed archived apartment description.',
    governorate: { nameAr: 'الدقهلية', nameEn: 'Dakahlia' },
    city: { nameAr: 'المنصورة', nameEn: 'Mansoura' },
    district: 'University district',
    propertyType: 'APARTMENT',
    rentAmount: 5000,
    areaM2: 100,
    bedrooms: 2,
    bathrooms: 1,
    isFurnished: false,
    hasElevator: true,
    hasParking: false,
    isBoosted: false,
    status: 'ARCHIVED',
    manualAddress: 'Detailed street address',
    propertyAroundServices: null,
    rejectionReason: 'يرجى تحسين صور العقار',
    approvedAt: new Date('2026-07-20T12:00:00.000Z'),
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    propertyImages: [],
    owner: {
      fullName: 'Owner',
      phoneNumber: '01000000000',
      identityVerification: { status: 'APPROVED' },
    },
  };

  it('allows an owner to view their archived property', async () => {
    const service = new PropertiesService(
      {
        property: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(archivedProperty),
        },
      } as never,
      {} as never,
    );

    await expect(
      service.getPropertyById('property-1', {
        userId: 'owner-1',
        role: 'LANDLORD',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'property-1',
        status: 'ARCHIVED',
        contactRevealed: true,
        rejectionReason: 'يرجى تحسين صور العقار',
      }),
    );
  });

  it('restores an archived owner property to pending review instead of publishing it', async () => {
    const propertyEdited = jest.fn();
    const update = jest.fn().mockResolvedValue({
      ...archivedProperty,
      status: 'PENDING',
      isBoosted: false,
      boostedUntil: null,
      approvedBy: null,
    });
    const service = new PropertiesService(
      {
        property: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'property-1', status: 'ARCHIVED' }),
          update,
        },
      } as never,
      { propertyEdited, propertySubmitted: jest.fn() } as never,
    );

    await expect(service.unarchive('owner-1', 'property-1')).resolves.toEqual(
      expect.objectContaining({
        property: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'property-1' },
        data: {
          status: 'PENDING',
          isBoosted: false,
          boostedUntil: null,
          approvedBy: null,
        },
      }),
    );
    expect(propertyEdited).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'property-1', status: 'PENDING' }),
    );
  });

  it('keeps an archived property hidden from a non-owner', async () => {
    const service = new PropertiesService(
      {
        property: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(archivedProperty),
        },
      } as never,
      {} as never,
    );

    await expect(
      service.getPropertyById('property-1', {
        userId: 'tenant-1',
        role: 'TENANT',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
