import { NotFoundException } from '@nestjs/common';
import { OffersService } from './offers.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Regression coverage for the "74% on the request card vs 86% in the Send
 * Offer modal" bug: the modal used to reimplement the scoring formula
 * client-side (missing the semantic + lifestyle terms), instead of reading
 * the same computeHybridMatch() browseRequests() already uses. These tests
 * pin getPropertyScoresForRequest to that single source of truth.
 */
describe('OffersService.getPropertyScoresForRequest', () => {
  const findUniqueRequest = jest.fn();
  const findManyProperty = jest.fn();

  const service = new OffersService(
    {
      tenantRequest: { findUnique: findUniqueRequest },
      property: { findMany: findManyProperty },
    } as unknown as PrismaService,
    {} as RealtimeService,
    { minSimilarity: 0.5 },
  );

  const request = {
    id: 'request-1',
    minBudget: 2000,
    maxBudget: 5000,
    preferredLocations: 'الاستاد',
    propertyType: 'APARTMENT',
    requiredBedrooms: 2,
    needsFurnished: false,
    flexibilityScore: 5,
    lifestyleRequirements: '',
    embedding: [] as number[],
  };

  const property = {
    id: 'property-1',
    ownerId: 'owner-1',
    status: 'APPROVED',
    rentAmount: 5000,
    district: 'الاستاد',
    propertyType: 'APARTMENT',
    bedrooms: 2,
    isFurnished: true,
    description: '',
    propertyAroundServices: '',
    isBoosted: false,
    embedding: [] as number[],
  };

  beforeEach(() => jest.clearAllMocks());

  it('scores a property with the exact same formula browseRequests uses', async () => {
    findUniqueRequest.mockResolvedValue(request);
    findManyProperty.mockResolvedValue([property]);

    const result = await service.getPropertyScoresForRequest(
      'owner-1',
      'request-1',
    );

    // scoreRequestAgainstProperty: 50 base, +18 within budget, +12 matching
    // district, +8 matching type, +5 enough bedrooms, +5 furnished-not-required
    // = 98, then clamped to 98. No embedding on either side, so
    // combineHybridScore degrades to the rule score unchanged.
    expect(result).toEqual({
      items: [expect.objectContaining({ propertyId: 'property-1', score: 98 })],
    });
  });

  it("only scores this landlord's own APPROVED properties", async () => {
    findUniqueRequest.mockResolvedValue(request);
    findManyProperty.mockResolvedValue([property]);

    await service.getPropertyScoresForRequest('owner-1', 'request-1');

    expect(findManyProperty).toHaveBeenCalledWith({
      where: { ownerId: 'owner-1', status: 'APPROVED' },
    });
  });

  it('404s when the tenant request does not exist', async () => {
    findUniqueRequest.mockResolvedValue(null);

    await expect(
      service.getPropertyScoresForRequest('owner-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
