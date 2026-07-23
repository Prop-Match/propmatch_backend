import { PrismaService } from '../../prisma/prisma.service';
import { ChromaPropertyService } from './chroma-property.service';
import { PropertyApprovalIndexingService } from './property-approval-indexing.service';
import { PropertyEmbeddingService } from './property-embedding.service';

describe('PropertyApprovalIndexingService', () => {
  const findUnique = jest.fn();
  const build = jest.fn();
  const createEmbedding = jest.fn();
  const upsert = jest.fn();
  const service = new PropertyApprovalIndexingService(
    { property: { findUnique } } as unknown as PrismaService,
    { build },
    { createEmbedding } as unknown as PropertyEmbeddingService,
    { upsert } as unknown as ChromaPropertyService,
  );

  const property = {
    id: 'property-1',
    status: 'APPROVED',
    title: 'Apartment',
    description: 'Sunny home',
    governorate: { nameAr: 'القاهرة', nameEn: 'Cairo' },
    city: { nameAr: 'القاهرة', nameEn: 'Cairo' },
    district: 'Maadi',
    propertyType: 'APARTMENT',
    propertyAroundServices: 'Metro',
    rentAmount: 5000,
    areaM2: 100,
    bedrooms: 2,
    bathrooms: 1,
    isFurnished: true,
    hasElevator: true,
    hasParking: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue(property);
    build.mockReturnValue({
      document: 'safe document',
      metadata: { city: 'Cairo' },
    });
    createEmbedding.mockResolvedValue([0.1, 0.2]);
    upsert.mockResolvedValue(undefined);
  });

  it('reloads the approved property and upserts its safe document with a stable id', async () => {
    await service.indexApprovedProperty('property-1');

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'property-1' },
      }),
    );
    expect(build).toHaveBeenCalledWith({
      ...property,
      governorate: property.governorate.nameAr,
      city: property.city.nameAr,
    });
    expect(createEmbedding).toHaveBeenCalledWith('safe document');
    expect(upsert).toHaveBeenCalledWith(
      'property:property-1',
      'safe document',
      [0.1, 0.2],
      { city: 'Cairo' },
    );
  });

  it.each([null, { ...property, status: 'PENDING' }])(
    'skips missing or non-approved properties safely',
    async (result) => {
      findUnique.mockResolvedValueOnce(result);

      await service.indexApprovedProperty('property-1');

      expect(build).not.toHaveBeenCalled();
      expect(createEmbedding).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it('uses the same vector id when reprocessing', async () => {
    await service.indexApprovedProperty('property-1');
    await service.indexApprovedProperty('property-1');

    expect(upsert).toHaveBeenNthCalledWith(
      1,
      'property:property-1',
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
    );
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      'property:property-1',
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
    );
  });
});
