import { ServiceUnavailableException } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { SemanticMatchingConfig } from '../config/semantic-matching.config';

describe('PropertiesService.semanticSearch', () => {
  const findMany = jest.fn();
  const createEmbedding = jest.fn();
  const query = jest.fn();
  const createService = (minSimilarity = 0.65) =>
    new PropertiesService(
      { property: { findMany } } as never,
      {} as never,
      { createEmbedding } as never,
      { query } as never,
      { minSimilarity } as SemanticMatchingConfig,
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

    const result = await createService().semanticSearch({ query: 'near university', limit: 5 });

    expect(createEmbedding).toHaveBeenCalledWith('near university');
    expect(query).toHaveBeenCalledWith({ embedding: [0.1, 0.2], limit: 5 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['b', 'a'] }, status: 'APPROVED' } }));
    expect(result.items.map((item) => item.id)).toEqual(['b', 'a']);
    expect(result.items.map((item) => item.semanticSimilarity)).toEqual([0.9, 0.8]);
    expect(result.resultCount).toBe(result.items.length);
    expect(result.total).toBe(result.resultCount);
    expect(result.items[0]).not.toHaveProperty('ownerId');
  });

  it('returns a successful empty list when Chroma has no matches', async () => {
    query.mockResolvedValue([]);
    await expect(createService().semanticSearch({ query: 'nowhere', limit: 10 })).resolves.toEqual({
      items: [], total: 0, resultCount: 0, page: 1, pageSize: 10,
      reason: 'NO_RELEVANT_SEMANTIC_MATCH',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('sanitizes embedding and vector provider failures', async () => {
    createEmbedding.mockRejectedValue(new Error('provider details'));
    await expect(createService().semanticSearch({ query: 'test', limit: 10 })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps candidates above or equal to the threshold in Chroma order', async () => {
    query.mockResolvedValue([
      { vectorId: 'property:above', propertyId: 'above', distance: 0.2 },
      { vectorId: 'property:equal', propertyId: 'equal', distance: 0.35 },
      { vectorId: 'property:below', propertyId: 'below', distance: 0.6 },
    ]);
    findMany.mockResolvedValue([
      approved('equal'),
      approved('above'),
      approved('below'),
    ]);

    const result = await createService(0.65).semanticSearch({
      query: 'near university',
      limit: 5,
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['above', 'equal'] }, status: 'APPROVED' },
    }));
    expect(result.items.map((item) => item.id)).toEqual(['above', 'equal']);
    expect(result.items.map((item) => item.semanticSimilarity)).toEqual([0.8, 0.65]);
    expect(result.resultCount).toBe(2);
    expect(result.total).toBe(result.resultCount);
    expect(result).not.toHaveProperty('distance');
    expect(JSON.stringify(result)).not.toContain('embedding');
  });

  it('returns a successful empty list when every candidate is below the threshold', async () => {
    query.mockResolvedValue([
      { vectorId: 'property:weak', propertyId: 'weak', distance: 0.6 },
    ]);

    await expect(createService(0.65).semanticSearch({
      query: 'near university',
      limit: 5,
    })).resolves.toEqual({
      items: [], total: 0, resultCount: 0, page: 1, pageSize: 5,
      reason: 'NO_RELEVANT_SEMANTIC_MATCH',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('removes unapproved hydrated properties and reports a semantic no-match', async () => {
    query.mockResolvedValue([
      { vectorId: 'property:unapproved', propertyId: 'unapproved', distance: 0.2 },
    ]);
    findMany.mockResolvedValue([]);

    await expect(createService().semanticSearch({
      query: 'near university',
      limit: 5,
    })).resolves.toEqual({
      items: [], total: 0, resultCount: 0, page: 1, pageSize: 5,
      reason: 'NO_RELEVANT_SEMANTIC_MATCH',
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['unapproved'] }, status: 'APPROVED' },
    }));
  });
});
