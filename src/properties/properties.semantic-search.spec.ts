import { ServiceUnavailableException } from '@nestjs/common';
import { PropertiesService } from './properties.service';

describe('PropertiesService.semanticSearch', () => {
  const findMany = jest.fn();
  const createEmbedding = jest.fn();
  const query = jest.fn();
  const service = new PropertiesService(
    { property: { findMany } } as never,
    {} as never,
    { createEmbedding } as never,
    { query } as never,
  );

  const approved = (id: string) => ({
    id,
    title: id,
    governorate: 'Cairo', city: 'Cairo', district: 'Maadi', propertyType: 'APARTMENT',
    rentAmount: 5000, areaM2: 100, bedrooms: 2, bathrooms: 1, isFurnished: false,
    isBoosted: false, status: 'APPROVED', propertyImages: [], owner: null,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    createEmbedding.mockResolvedValue([0.1, 0.2]);
  });

  it('hydrates only approved records in vector relevance order and deduplicates ids', async () => {
    query.mockResolvedValue([
      { vectorId: 'property:b', propertyId: 'b', distance: 0.1 },
      { vectorId: 'property:a', propertyId: 'a', distance: 0.2 },
      { vectorId: 'property:b', propertyId: 'b', distance: 0.3 },
      { vectorId: 'invalid', propertyId: '', distance: 0.4 },
    ]);
    findMany.mockResolvedValue([approved('a'), approved('b')]);

    const result = await service.semanticSearch({ query: 'near university', limit: 5 });

    expect(createEmbedding).toHaveBeenCalledWith('near university');
    expect(query).toHaveBeenCalledWith({ embedding: [0.1, 0.2], limit: 5 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['b', 'a'] }, status: 'APPROVED' } }));
    expect(result.items.map((item) => item.id)).toEqual(['b', 'a']);
    expect(result.items[0]).not.toHaveProperty('ownerId');
  });

  it('returns a successful empty list when Chroma has no matches', async () => {
    query.mockResolvedValue([]);
    await expect(service.semanticSearch({ query: 'nowhere', limit: 10 })).resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 10 });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('sanitizes embedding and vector provider failures', async () => {
    createEmbedding.mockRejectedValue(new Error('provider details'));
    await expect(service.semanticSearch({ query: 'test', limit: 10 })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
