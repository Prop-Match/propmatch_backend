import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';

const DAY_MS = 24 * 60 * 60 * 1_000;
const VIEW_DEDUPE_WINDOW_MS = 30 * 60 * 1_000;

type AnalyticsCounter =
  | 'favoritesAdded'
  | 'favoritesRemoved'
  | 'tenantOffers'
  | 'ownerOffers'
  | 'matches';

function startOfUtcDay(value = new Date()): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

@Injectable()
export class PropertyAnalyticsService {
  private readonly hashSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly quotaService: QuotaService,
  ) {
    this.hashSecret =
      this.config.get<string>('ANALYTICS_HASH_SECRET') ??
      this.config.get<string>('JWT_ACCESS_SECRET') ??
      'propmatch-local-analytics-key';
  }

  private hash(value: string): string {
    return createHmac('sha256', this.hashSecret).update(value).digest('hex');
  }

  async trackView(
    propertyId: string,
    viewer: { userId: string; role: string } | undefined,
    visitorId: string | undefined,
    userAgent: string | undefined,
  ) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, status: 'APPROVED' },
      select: { id: true, ownerId: true },
    });
    if (!property) throw new NotFoundException('Property not found');

    const bot = /bot|crawler|spider|preview|headless/i.test(userAgent ?? '');
    const excluded =
      bot || viewer?.role === 'ADMIN' || viewer?.userId === property.ownerId;
    if (excluded || (!viewer?.userId && !visitorId)) {
      return { recorded: false, reason: 'EXCLUDED' as const };
    }

    const now = new Date();
    const rawVisitor = viewer?.userId
      ? `user:${viewer.userId}`
      : `anonymous:${visitorId}`;
    const visitorHash = this.hash(rawVisitor);
    const bucket = Math.floor(now.getTime() / VIEW_DEDUPE_WINDOW_MS);
    const dedupeKey = this.hash(`${propertyId}:${visitorHash}:${bucket}`);
    const day = startOfUtcDay(now);
    const tomorrow = new Date(day.getTime() + DAY_MS);

    const campaign = await this.prisma.boostCampaign.findFirst({
      where: {
        propertyId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: { endsAt: 'desc' },
      select: { id: true },
    });
    const trafficSource = campaign ? 'BOOSTED' : 'ORGANIC';

    try {
      const uniqueToday =
        (await this.prisma.propertyViewEvent.count({
          where: {
            propertyId,
            visitorHash,
            occurredAt: { gte: day, lt: tomorrow },
          },
        })) === 0;

      await this.prisma.$transaction([
        this.prisma.propertyViewEvent.create({
          data: {
            propertyId,
            viewerId: viewer?.userId,
            visitorHash,
            dedupeKey,
            trafficSource,
            boostCampaignId: campaign?.id,
            occurredAt: now,
          },
        }),
        this.prisma.propertyAnalyticsDaily.upsert({
          where: { propertyId_date: { propertyId, date: day } },
          create: {
            propertyId,
            date: day,
            views: 1,
            uniqueViews: uniqueToday ? 1 : 0,
            organicViews: trafficSource === 'ORGANIC' ? 1 : 0,
            boostedViews: trafficSource === 'BOOSTED' ? 1 : 0,
          },
          update: {
            views: { increment: 1 },
            uniqueViews: { increment: uniqueToday ? 1 : 0 },
            organicViews: {
              increment: trafficSource === 'ORGANIC' ? 1 : 0,
            },
            boostedViews: {
              increment: trafficSource === 'BOOSTED' ? 1 : 0,
            },
          },
        }),
      ]);
      return { recorded: true, trafficSource };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        return { recorded: false, reason: 'DUPLICATE' as const };
      }
      throw error;
    }
  }

  async recordCounter(propertyId: string, counter: AnalyticsCounter) {
    const date = startOfUtcDay();
    await this.prisma.propertyAnalyticsDaily.upsert({
      where: { propertyId_date: { propertyId, date } },
      create: { propertyId, date, [counter]: 1 },
      update: { [counter]: { increment: 1 } },
    });
  }

  private rangeStart(
    period: '7d' | '30d' | 'current' | 'lifetime',
    currentPeriodStartsAt: Date | null,
  ): Date | undefined {
    if (period === 'lifetime') return undefined;
    if (period === 'current') return currentPeriodStartsAt ?? undefined;
    return new Date(Date.now() - (period === '7d' ? 7 : 30) * DAY_MS);
  }

  async getPropertyAnalytics(
    ownerId: string,
    propertyId: string,
    period: '7d' | '30d' | 'current' | 'lifetime',
  ) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ownerId, status: 'APPROVED' },
      select: { id: true, title: true },
    });
    if (!property) throw new NotFoundException('Property not found');

    const quota = await this.prisma.userQuota.findUnique({
      where: { userId: ownerId },
      select: { currentPeriodStartsAt: true },
    });
    const commercial = await this.quotaService.getCommercialPriority(ownerId);
    const start = this.rangeStart(period, quota?.currentPeriodStartsAt ?? null);
    const createdAt = start ? { gte: start } : undefined;

    const [
      views,
      uniqueVisitors,
      traffic,
      favorites,
      tenantOffers,
      ownerOffers,
      matches,
      series,
    ] = await Promise.all([
      this.prisma.propertyViewEvent.count({
        where: { propertyId, occurredAt: createdAt },
      }),
      this.prisma.propertyViewEvent.groupBy({
        by: ['visitorHash'],
        where: { propertyId, occurredAt: createdAt },
      }),
      this.prisma.propertyViewEvent.groupBy({
        by: ['trafficSource'],
        where: { propertyId, occurredAt: createdAt },
        _count: { _all: true },
      }),
      this.prisma.favorite.count({ where: { propertyId } }),
      this.prisma.tenantOffer.count({
        where: { propertyId, createdAt },
      }),
      this.prisma.ownerOffer.count({
        where: { propertyId, createdAt },
      }),
      this.prisma.matchConnection.count({
        where: { propertyId, status: 'CONNECTED', createdAt },
      }),
      this.prisma.propertyAnalyticsDaily.findMany({
        where: { propertyId, date: createdAt },
        orderBy: { date: 'asc' },
      }),
    ]);

    const organicViews =
      traffic.find((row) => row.trafficSource === 'ORGANIC')?._count._all ?? 0;
    const boostedViews =
      traffic.find((row) => row.trafficSource === 'BOOSTED')?._count._all ?? 0;
    const canSeeMatches = commercial.tier !== 'FREEMIUM';
    const canSeeConversion = commercial.tier === 'PREMIUM';

    return {
      property: { id: property.id, title: property.title },
      period,
      capabilities: {
        matches: canSeeMatches,
        boostedVsOrganic: canSeeConversion,
        conversion: canSeeConversion,
      },
      totals: {
        views,
        uniqueViews: uniqueVisitors.length,
        favorites,
        tenantOffersReceived: tenantOffers,
        reverseOffersSent: ownerOffers,
        matches: canSeeMatches ? matches : null,
        organicViews: canSeeConversion ? organicViews : null,
        boostedViews: canSeeConversion ? boostedViews : null,
        viewToOfferRate:
          canSeeConversion && views > 0
            ? Number(((tenantOffers + ownerOffers) / views).toFixed(4))
            : null,
      },
      series: series.map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        views: row.views,
        uniqueViews: row.uniqueViews,
        favoritesAdded: row.favoritesAdded,
        favoritesRemoved: row.favoritesRemoved,
        tenantOffersReceived: row.tenantOffers,
        reverseOffersSent: row.ownerOffers,
        matches: canSeeMatches ? row.matches : null,
        organicViews: canSeeConversion ? row.organicViews : null,
        boostedViews: canSeeConversion ? row.boostedViews : null,
      })),
    };
  }
}
