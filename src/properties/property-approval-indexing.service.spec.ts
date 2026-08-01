import { PrismaService } from '../../prisma/prisma.service';
import { ChromaPropertyService } from './chroma-property.service';
import { PropertyApprovalIndexingService } from './property-approval-indexing.service';
import { PropertyEmbeddingService } from './property-embedding.service';

describe('PropertyApprovalIndexingService', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const build = jest.fn();
  const createCohereEmbedding = jest.fn();
  const createLocalEmbedding = jest.fn();
  const isLocalEmbeddingEnabled = jest.fn();
  const upsert = jest.fn();
  const service = new PropertyApprovalIndexingService(
    { property: { findUnique, update } } as unknown as PrismaService,
    { build },
    {
      createCohereEmbedding,
      createLocalEmbedding,
      isLocalEmbeddingEnabled,
    } as unknown as PropertyEmbeddingService,
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
    update.mockResolvedValue(undefined);
    build.mockReturnValue({
      document: 'safe document',
      metadata: { city: 'Cairo' },
    });
    createCohereEmbedding.mockResolvedValue([0.1, 0.2]);
    createLocalEmbedding.mockResolvedValue([0.3, 0.4]);
    isLocalEmbeddingEnabled.mockReturnValue(true);
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
    expect(createCohereEmbedding).toHaveBeenCalledWith(
      'safe document',
      'search_document',
    );
    expect(createLocalEmbedding).toHaveBeenCalledWith('safe document');
    expect(upsert).toHaveBeenCalledWith(
      'cohere',
      'property:property-1',
      'safe document',
      [0.1, 0.2],
      { city: 'Cairo' },
    );
    expect(upsert).toHaveBeenCalledWith(
      'local',
      'property:property-1',
      'safe document',
      [0.3, 0.4],
      { city: 'Cairo' },
    );
    // Cohere succeeded, so it's the "primary" vector persisted for the
    // hybrid matcher's local cosine-similarity path (Property.embedding).
    expect(update).toHaveBeenCalledWith({
      where: { id: 'property-1' },
      data: { embedding: [0.1, 0.2] },
    });
  });

  it('persists the local vector as primary when Cohere fails', async () => {
    createCohereEmbedding.mockRejectedValue(
      new Error('COHERE_EMBEDDING_NOT_CONFIGURED'),
    );

    await service.indexApprovedProperty('property-1');

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      'local',
      'property:property-1',
      'safe document',
      [0.3, 0.4],
      { city: 'Cairo' },
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'property-1' },
      data: { embedding: [0.3, 0.4] },
    });
  });

  it('throws when both providers fail, leaving the property unindexed', async () => {
    createCohereEmbedding.mockRejectedValue(
      new Error('COHERE_EMBEDDING_NOT_CONFIGURED'),
    );
    createLocalEmbedding.mockRejectedValue(
      new Error('LOCAL_EMBEDDING_SERVICE_UNAVAILABLE'),
    );

    await expect(service.indexApprovedProperty('property-1')).rejects.toThrow();

    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([null, { ...property, status: 'PENDING' }])(
    'skips missing or non-approved properties safely',
    async (result) => {
      findUnique.mockResolvedValueOnce(result);

      await service.indexApprovedProperty('property-1');

      expect(build).not.toHaveBeenCalled();
      expect(createCohereEmbedding).not.toHaveBeenCalled();
      expect(createLocalEmbedding).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it('uses the same vector id when reprocessing', async () => {
    await service.indexApprovedProperty('property-1');
    await service.indexApprovedProperty('property-1');

    expect(upsert).toHaveBeenCalledTimes(4);
    expect(upsert).toHaveBeenNthCalledWith(
      1,
      'cohere',
      'property:property-1',
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
    );
    expect(upsert).toHaveBeenNthCalledWith(
      4,
      'local',
      'property:property-1',
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
    );
  });
});
