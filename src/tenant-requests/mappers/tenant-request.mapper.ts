import { TenantRequest } from 'generated/prisma/client';

/* ────────────────── Frontend response interface ─────────────────────────── */

export interface TenantRequestResponse {
  id: string;
  tenantId: string;
  minBudget: number;
  maxBudget: number;
  preferredLocations: string;
  propertyType: string;
  requiredBedrooms: number;
  needsFurnished: boolean;
  flexibilityScore: number;
  lifestyleRequirements: string;
  status: string;
  rejectionReason: string | null;
  offersCount: number;
  createdAt: string;
}

/* ──────────────────────────── Mapper function ───────────────────────────── */

/**
 * Transform a Prisma TenantRequest to the frontend shape.
 *
 * The frontend expects:
 *  - `rejectionReason` (not in Prisma schema yet — always null for now)
 *  - `offersCount` (derived from the OwnerOffer relation count)
 *  - `createdAt` as ISO string
 */
export function transformTenantRequest(
  request,
  offersCount: number,
): TenantRequestResponse {
  return {
    id: request.id,
    tenantId: request.tenantId,
    minBudget: request.minBudget,
    maxBudget: request.maxBudget,
    preferredLocations: request.preferredLocations,
    propertyType: request.propertyType,
    requiredBedrooms: request.requiredBedrooms,
    needsFurnished: request.needsFurnished,
    flexibilityScore: request.flexibilityScore,
    lifestyleRequirements: request.lifestyleRequirements,
    status: request.status,
    rejectionReason: null, // Not in Prisma schema yet
    offersCount,
    createdAt: request.createdAt.toISOString(),
  };
}
