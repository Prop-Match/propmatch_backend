/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { PropertyAnalyticsService } from './property-analytics.service';

describe('PropertyAnalyticsService view integrity', () => {
  it('excludes the owner and bots from property view counts', async () => {
    const create = jest.fn();
    const prisma = {
      property: {
        findFirst: jest.fn(async () => ({
          id: 'property-1',
          ownerId: 'owner-1',
        })),
      },
      propertyViewEvent: { create },
    } as unknown as PrismaService;
    const service = new PropertyAnalyticsService(
      prisma,
      { get: jest.fn(() => 'test-secret') } as unknown as ConfigService,
      {} as QuotaService,
    );

    await expect(
      service.trackView(
        'property-1',
        { userId: 'owner-1', role: 'LANDLORD' },
        undefined,
        'Mozilla/5.0',
      ),
    ).resolves.toEqual({ recorded: false, reason: 'EXCLUDED' });
    await expect(
      service.trackView(
        'property-1',
        undefined,
        'visitor-id-123456',
        'Googlebot',
      ),
    ).resolves.toEqual({ recorded: false, reason: 'EXCLUDED' });
    expect(create).not.toHaveBeenCalled();
  });

  it('attributes genuine views to an active Boost campaign without fabricating values', async () => {
    const createEvent = jest.fn(async ({ data }) => data);
    const upsertDaily = jest.fn(async ({ create }) => create);
    const prisma = {
      property: {
        findFirst: jest.fn(async () => ({
          id: 'property-1',
          ownerId: 'owner-1',
        })),
      },
      boostCampaign: { findFirst: jest.fn(async () => ({ id: 'campaign-1' })) },
      propertyViewEvent: {
        count: jest.fn(async () => 0),
        create: createEvent,
      },
      propertyAnalyticsDaily: { upsert: upsertDaily },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    } as unknown as PrismaService;
    const service = new PropertyAnalyticsService(
      prisma,
      { get: jest.fn(() => 'test-secret') } as unknown as ConfigService,
      {} as QuotaService,
    );

    await expect(
      service.trackView(
        'property-1',
        { userId: 'tenant-1', role: 'TENANT' },
        undefined,
        'Mozilla/5.0',
      ),
    ).resolves.toEqual({ recorded: true, trafficSource: 'BOOSTED' });
    expect(createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        trafficSource: 'BOOSTED',
        boostCampaignId: 'campaign-1',
      }),
    });
    expect(upsertDaily).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ boostedViews: 1, views: 1 }),
      }),
    );
  });
});
