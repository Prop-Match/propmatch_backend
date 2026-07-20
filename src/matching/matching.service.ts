import { Injectable } from '@nestjs/common';
import { Property, TenantRequest } from 'generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Matches the frontend `BrowsableTenantRequest` (tenantRequest.ts). */
export interface BrowsableTenantRequestResponse {
  id: string;
  minBudget: number;
  maxBudget: number;
  preferredLocations: string;
  propertyType: string;
  requiredBedrooms: number;
  needsFurnished: boolean;
  flexibilityScore: number;
  lifestyleRequirements: string;
  createdAt: string;
  /** Best score across this landlord's properties (0–100), or null if none. */
  matchScore: number | null;
  alreadyOffered: boolean;
  bestMatchingProperty: { id: string; title: string } | null;
}

/**
 * Hybrid match score (PRO-11/13).
 *
 * Ported VERBATIM from the frontend mock (`scoreRequestAgainstProperty` in
 * src/mocks/router.ts) so the number is identical whether it comes from the
 * mock or the real backend. This is the placeholder for Samer's ChromaDB
 * embedding similarity — swap the lifestyle-overlap block for the vector score
 * when it lands, keep the rest. Clamped 5–98.
 */
export function scoreRequestAgainstProperty(r: TenantRequest, p: Property): number {
  let score = 50;
  if (p.rentAmount >= r.minBudget && p.rentAmount <= r.maxBudget) score += 18;
  else score -= 22;
  if (r.preferredLocations.includes(p.district)) score += 12;
  if (p.propertyType === r.propertyType) score += 8;
  if (p.bedrooms >= r.requiredBedrooms) score += 5;
  if (!r.needsFurnished || p.isFurnished) score += 5;
  // Free-text lifestyle overlap — the bit the real system does with embeddings.
  const words = r.lifestyleRequirements.split(/\s+/).filter((w) => w.length > 3);
  const haystack = `${p.description} ${p.propertyAroundServices ?? ''}`;
  score += Math.min(10, words.filter((w) => haystack.includes(w)).length * 2);
  // Flexibility softens a mismatch.
  score += Math.round((r.flexibilityScore - 5) * 0.6);
  if (p.isBoosted) score += 2;
  return Math.max(5, Math.min(98, Math.round(score)));
}

@Injectable()
export class MatchingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRO-13 — approved tenant requests a verified landlord can browse, each
   * scored against that landlord's own APPROVED properties, best score first.
   *
   * The tenant's identity is intentionally ABSENT from the payload (no name,
   * phone, or tenantId): a landlord only learns who the tenant is after the
   * tenant accepts one of their offers. Omission, not client-side hiding.
   */
  async browsableRequestsForLandlord(
    landlordId: string,
  ): Promise<{ items: BrowsableTenantRequestResponse[] }> {
    const [myProperties, requests, myOffers] = await Promise.all([
      this.prisma.property.findMany({
        where: { ownerId: landlordId, status: 'APPROVED' },
      }),
      this.prisma.tenantRequest.findMany({ where: { status: 'APPROVED' } }),
      this.prisma.ownerOffer.findMany({
        where: { ownerId: landlordId },
        select: { tenantRequestId: true },
      }),
    ]);

    const alreadyOffered = new Set(myOffers.map((o) => o.tenantRequestId));

    const items = requests.map((request) => {
      let matchScore: number | null = null;
      let bestMatchingProperty: { id: string; title: string } | null = null;

      for (const property of myProperties) {
        const score = scoreRequestAgainstProperty(request, property);
        if (matchScore === null || score > matchScore) {
          matchScore = score;
          bestMatchingProperty = { id: property.id, title: property.title };
        }
      }

      return {
        id: request.id,
        minBudget: request.minBudget,
        maxBudget: request.maxBudget,
        preferredLocations: request.preferredLocations,
        propertyType: request.propertyType,
        requiredBedrooms: request.requiredBedrooms,
        needsFurnished: request.needsFurnished,
        flexibilityScore: request.flexibilityScore,
        lifestyleRequirements: request.lifestyleRequirements,
        createdAt: request.createdAt.toISOString(),
        matchScore,
        alreadyOffered: alreadyOffered.has(request.id),
        bestMatchingProperty,
      };
    });

    // Highest match first; unscored (landlord has no properties) sink to null→0.
    items.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    return { items };
  }
}
