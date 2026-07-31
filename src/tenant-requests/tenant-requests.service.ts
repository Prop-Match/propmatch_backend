import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  MATCH_TENANT_REQUEST_JOB,
  MATCHING_QUEUE,
  MatchTenantRequestJobData,
} from '../matching/matching.constants';
import { CreateTenantRequestDto } from './dto/create-tenant-request.dto';
import { transformTenantRequest } from './mappers/tenant-request.mapper';

@Injectable()
export class TenantRequestsService {
  private readonly logger = new Logger(TenantRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    @InjectQueue(MATCHING_QUEUE)
    private readonly matchingQueue: Queue<MatchTenantRequestJobData>,
  ) {}

  /**
   * Create a new tenant request (PRO-05).
   *
   * Business rules (mirrors the mock router):
   *  1. Tenant verification is enforced by VerifiedGuard.
   *  2. Request starts in PENDING status — admin must approve (anti-spam, SRS 3.2.2).
   */
  async create(tenantId: string, dto: CreateTenantRequestDto) {
    const request = await this.prisma.tenantRequest.create({
      data: {
        tenantId,
        minBudget: dto.minBudget,
        maxBudget: dto.maxBudget,
        preferredLocations: dto.preferredLocations,
        propertyType: dto.propertyType,
        requiredBedrooms: dto.requiredBedrooms,
        needsFurnished: dto.needsFurnished,
        flexibilityScore: dto.flexibilityScore,
        lifestyleRequirements: dto.lifestyleRequirements,
        // status defaults to PENDING via Prisma schema
      },
    });

    this.realtimeService.tenantRequestSubmitted(request);

    // Smart Matchmaker: enqueue background scoring/notification instead of
    // computing it inline — this call only persists the job to Redis, it
    // does not wait for the worker, so request creation stays fast. A queue
    // hiccup degrades to "no proactive match notifications this time"
    // rather than failing the tenant's request.
    try {
      await this.matchingQueue.add(MATCH_TENANT_REQUEST_JOB, {
        tenantRequestId: request.id,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue matching job for TenantRequest ${request.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // New request has zero offers
    return transformTenantRequest(request);
  }

  /** GET /tenant/requests — the tenant's own requests, each with its offer count. */
  async findMine(tenantId: string) {
    const requests = await this.prisma.tenantRequest.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { ownerOffers: true } } },
    });

    return {
      items: requests.map((r) => transformTenantRequest(r)),
    };
  }

  /** POST /tenant/requests/:id/close — the tenant withdraws their own request. */
  async close(tenantId: string, id: string) {
    const request = await this.prisma.tenantRequest.findFirst({
      where: { id, tenantId },
    });
    if (!request) throw new NotFoundException('Tenant request not found.');

    await this.prisma.tenantRequest.update({
      where: { id },
      data: { status: 'CLOSED' },
    });

    return { ok: true };
  }
}
