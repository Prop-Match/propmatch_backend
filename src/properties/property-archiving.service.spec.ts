import { PropertiesService } from './properties.service';

const archivedProperty = {
  id: 'property-1',
  ownerId: 'owner-1',
  title: 'Archived apartment',
  description: 'A property that the owner has archived.',
  district: 'Maadi',
  propertyType: 'APARTMENT',
  propertyAroundServices: null,
  rentAmount: 10000,
  areaM2: 90,
  bedrooms: 2,
  bathrooms: 1,
  isFurnished: false,
  hasElevator: true,
  hasParking: false,
  isBoosted: false,
  status: 'ARCHIVED',
  manualAddress: 'Owner-only address',
  approvedAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  propertyImages: [],
  governorate: { nameAr: 'القاهرة', nameEn: 'Cairo' },
  city: { nameAr: 'القاهرة', nameEn: 'Cairo' },
  country: { nameAr: 'مصر', nameEn: 'Egypt' },
  owner: {
    fullName: 'Property owner',
    phoneNumber: '01000000000',
    identityVerification: { status: 'APPROVED' },
  },
};

describe('PropertiesService archiving', () => {
  it('allows an owner to archive their own property', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValue({ id: 'property-1', status: 'APPROVED' });
    const update = jest.fn().mockResolvedValue(archivedProperty);
    const service = new PropertiesService(
      { property: { findFirst, update } } as never,
      {} as never,
    );

    await expect(service.archive('owner-1', 'property-1')).resolves.toEqual({
      property: expect.objectContaining({
        id: 'property-1',
        status: 'ARCHIVED',
      }),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'property-1', ownerId: 'owner-1' },
      select: { id: true, status: true },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'property-1' },
        data: { status: 'ARCHIVED' },
      }),
    );
  });

  it('rejects an archive request from a different owner', async () => {
    const service = new PropertiesService(
      { property: { findFirst: jest.fn().mockResolvedValue(null) } } as never,
      {} as never,
    );

    await expect(
      service.archive('owner-2', 'property-1'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('excludes archived properties from public listings', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const service = new PropertiesService(
      { property: { findMany, count } } as never,
      {} as never,
    );

    await expect(service.getAll({})).resolves.toEqual({ items: [], total: 0 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'APPROVED' } }),
    );
    expect(count).toHaveBeenCalledWith({ where: { status: 'APPROVED' } });
  });

  it("keeps an owner's archived property in their management list", async () => {
    const findMany = jest.fn().mockResolvedValue([archivedProperty]);
    const count = jest.fn().mockResolvedValue(1);
    const service = new PropertiesService(
      { property: { findMany, count } } as never,
      {} as never,
    );

    await expect(service.getMyProperties('owner-1')).resolves.toEqual({
      items: [
        expect.objectContaining({ id: 'property-1', status: 'ARCHIVED' }),
      ],
      total: 1,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 'owner-1' } }),
    );
    expect(count).toHaveBeenCalledWith({ where: { ownerId: 'owner-1' } });
  });
});
