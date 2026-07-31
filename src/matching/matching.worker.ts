import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertyEmbeddingService } from '../properties/property-embedding.service';
import { SemanticMatchingConfig } from '../config/semantic-matching.config';
import { RealtimeService } from '../realtime/realtime.service';
import {
  combineHybridScore,
  scoreRequestAgainstProperty,
} from '../offers/match-score.util';
import { cosineSimilarity } from './matching.math.util';
import { buildHybridMatchReasons } from './hybrid-match-reasons.util';
import {
  HIGH_MATCH_NOTIFICATION_THRESHOLD,
  MATCH_TENANT_REQUEST_JOB,
  MATCHING_QUEUE,
  MatchTenantRequestJobData,
} from './matching.constants';

interface RankedMatch {
  propertyId: string;
  ownerId: string;
  title: string;
  ruleScore: number;
  semanticSimilarity: number | null;
  finalScore: number;
  matchReasons: { code: string; text: string }[];
}

/**
 * Consumes matching-queue jobs off the event loop's request path (PropMatch
 * Smart Matchmaker). Embeds the tenant request once, pre-filters candidate
 * properties with a plain SQL query, then scores everything left with local
 * cosine similarity against each property's cached `embedding` column — no
 * per-candidate ChromaDB round-trip.
 *
 * Candidates scoring above HIGH_MATCH_NOTIFICATION_THRESHOLD get a bulk
 * Notification insert + batched Socket.io emit to their owning landlord
 * (RealtimeService.notifyUsers — persist-then-emit, same as everywhere else
 * in the app).
 */
@Processor(MATCHING_QUEUE)
export class MatchingWorker extends WorkerHost {
  private readonly logger = new Logger(MatchingWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: PropertyEmbeddingService,
    private readonly semanticMatchingConfig: SemanticMatchingConfig,
    private readonly realtimeService: RealtimeService,
  ) {
    super();
  }

  async process(job: Job<MatchTenantRequestJobData>): Promise<void> {
    if (job.name !== MATCH_TENANT_REQUEST_JOB) return;

    console.log('Processing match for request ID:', job.data.tenantRequestId);

    const request = await this.prisma.tenantRequest.findUnique({
      where: { id: job.data.tenantRequestId },
    });
    if (!request) {
      this.logger.warn(
        `TenantRequest ${job.data.tenantRequestId} no longer exists; skipping match run.`,
      );
      return;
    }

    // Embed once. A failure here (Cohere down AND local fallback down/disabled)
    // degrades the whole run to rule-based-only rather than failing the job —
    // every property below will get semanticSimilarity: null.
    let requestVector: number[] | null = null;
    try {
      const query = [
        request.propertyType,
        request.preferredLocations,
        request.requiredBedrooms
          ? `${request.requiredBedrooms} bedrooms`
          : null,
        request.needsFurnished ? 'furnished' : null,
        request.lifestyleRequirements,
      ]
        .filter(Boolean)
        .join(', ');
      const vector = await this.embeddingService.createPrimaryEmbedding(
        query,
        'search_query',
      );
      requestVector = vector.embedding;
    } catch (error) {
      this.logger.warn(
        `Embedding failed for TenantRequest ${request.id}; falling back to rule-based scoring only. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Hard-rule SQL pre-filter: active listings within budget. Location is a
    // free-text field on TenantRequest (not a normalized column relationship),
    // so it's checked in-memory below rather than in the WHERE clause — same
    // semantics as the existing rule-based scorer (match-score.util.ts).
    const candidates = await this.prisma.property.findMany({
      where: {
        status: 'APPROVED',
        rentAmount: { gte: request.minBudget, lte: request.maxBudget },
      },
    });

    const ranked: RankedMatch[] = candidates
      .map((property) => {
        const ruleScore = scoreRequestAgainstProperty(request, property);

        const semanticSimilarity =
          requestVector && property.embedding.length > 0
            ? cosineSimilarity(requestVector, property.embedding)
            : null;

        const finalScore = combineHybridScore(ruleScore, semanticSimilarity);

        const matchReasons = buildHybridMatchReasons(
          request,
          property,
          semanticSimilarity,
          this.semanticMatchingConfig.minSimilarity,
        );

        return {
          propertyId: property.id,
          ownerId: property.ownerId,
          title: property.title,
          ruleScore,
          semanticSimilarity,
          finalScore,
          matchReasons,
        };
      })
      .sort((a, b) => b.finalScore - a.finalScore);

    this.logger.log(
      `Ranked ${ranked.length} candidate propert${ranked.length === 1 ? 'y' : 'ies'} for TenantRequest ${request.id} (embedding ${requestVector ? 'ok' : 'unavailable — rule-based only'}):`,
    );
    console.log(JSON.stringify(ranked, null, 2));

    const highMatches = ranked.filter(
      (match) => match.finalScore > HIGH_MATCH_NOTIFICATION_THRESHOLD,
    );
    if (highMatches.length === 0) return;

    const link = `/landlord/requests`;
    const created = await this.realtimeService.notifyUsers(
      highMatches.map((match) => ({
        userId: match.ownerId,
        type: 'HIGH_MATCH_TENANT_REQUEST',
        title: `تطابق قوي (${match.finalScore}٪) مع طلب سكن جديد`,
        message: [
          `عقارك "${match.title}" يطابق طلب سكن جديد بنسبة ${match.finalScore}٪.`,
          match.matchReasons.length > 0
            ? match.matchReasons.map((reason) => reason.text).join('، ')
            : null,
        ]
          .filter(Boolean)
          .join(' '),
        link,
      })),
    );

    this.logger.log(
      `Notified ${created.length} landlord(s) of a high match (>${HIGH_MATCH_NOTIFICATION_THRESHOLD}) for TenantRequest ${request.id}.`,
    );
  }
}
