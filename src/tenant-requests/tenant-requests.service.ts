import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTenantRequestDto } from './dto/create-tenant-request.dto';
import { transformTenantRequest } from './mappers/tenant-request.mapper';

@Injectable()
export class TenantRequestsService {
  private readonly logger = new Logger(TenantRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    // New request has zero offers
    return transformTenantRequest(request);
  }

  async getAllRequests(){
    const requests = await this.prisma.tenantRequest.findMany({
      include:{
        tenant:{select:{fullName:true,phoneNumber:true, identityVerification:{select:{status:true}}}},
        _count:{
          select:{ownerOffers:true}
        }
      }
    });

    return requests.map(r => transformTenantRequest(r));
  }

  /** GET /tenant/requests — the tenant's own requests, each with its offer count. */
  async findMine(tenantId: string) {
    const requests = await this.prisma.tenantRequest.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { ownerOffers: true } } },
    });

    return {
      items: requests.map((r) =>
        transformTenantRequest(r),
      ),
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
