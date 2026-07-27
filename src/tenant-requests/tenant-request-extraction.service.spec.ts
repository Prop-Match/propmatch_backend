import { BadGatewayException, GatewayTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import {
  SbgChatInvalidResponseError,
  SbgChatService,
  SbgChatTimeoutError,
  SbgChatUnavailableError,
} from '../common/services/sbg-chat.service';
import { TenantRequestExtractionService } from './tenant-request-extraction.service';

const completeSuggestions = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    minBudget: 7000,
    maxBudget: 9000,
    preferredLocations: 'حي الجامعة',
    propertyType: 'APARTMENT',
    requiredBedrooms: 2,
    needsFurnished: true,
    flexibilityScore: null,
    lifestyleRequirements: 'مكان هادئ',
    ...overrides,
  });

describe('TenantRequestExtractionService', () => {
  const complete = jest.fn();
  const service = new TenantRequestExtractionService(
    { complete } as unknown as SbgChatService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('returns validated suggestions and all null required fields as missing', async () => {
    complete.mockResolvedValue(completeSuggestions());

    await expect(
      service.extract('عايز شقة مفروشة غرفتين في حي الجامعة'),
    ).resolves.toEqual({
      originalText: 'عايز شقة مفروشة غرفتين في حي الجامعة',
      suggestions: {
        minBudget: 7000,
        maxBudget: 9000,
        preferredLocations: 'حي الجامعة',
        propertyType: 'APARTMENT',
        requiredBedrooms: 2,
        needsFurnished: true,
        flexibilityScore: null,
        lifestyleRequirements: 'مكان هادئ',
      },
      missingFields: ['flexibilityScore'],
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('preserves null values instead of inventing unstated facts', async () => {
    complete.mockResolvedValue(
      completeSuggestions({
        minBudget: null,
        maxBudget: null,
        preferredLocations: null,
        requiredBedrooms: null,
        needsFurnished: null,
        flexibilityScore: null,
      }),
    );

    const result = await service.extract('محتاج شقة هادية قريبة من المواصلات');

    expect(result.suggestions.minBudget).toBeNull();
    expect(result.suggestions.requiredBedrooms).toBeNull();
    expect(result.missingFields).toEqual([
      'minBudget',
      'maxBudget',
      'preferredLocations',
      'requiredBedrooms',
      'needsFurnished',
      'flexibilityScore',
    ]);
  });

  it.each([
    ['invalid property type', completeSuggestions({ propertyType: 'HOUSE' })],
    ['fractional bedrooms', completeSuggestions({ requiredBedrooms: 1.5 })],
    ['out-of-range flexibility', completeSuggestions({ flexibilityScore: 11 })],
    ['contradictory budgets', completeSuggestions({ minBudget: 9000, maxBudget: 7000 })],
    ['unknown provider field', JSON.stringify({ ...JSON.parse(completeSuggestions()), extra: true })],
    ['malformed JSON', '{not JSON'],
  ])('rejects %s as an invalid provider response', async (_label, response) => {
    complete.mockResolvedValue(response);

    await expect(service.extract('test request')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('maps provider failures to sanitized errors without another call', async () => {
    complete.mockRejectedValueOnce(new SbgChatTimeoutError('secret timeout'));
    await expect(service.extract('test request')).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );

    complete.mockRejectedValueOnce(new SbgChatUnavailableError('secret body'));
    await expect(service.extract('test request')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    complete.mockRejectedValueOnce(new SbgChatInvalidResponseError('raw body'));
    await expect(service.extract('test request')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(complete).toHaveBeenCalledTimes(3);
  });
});
