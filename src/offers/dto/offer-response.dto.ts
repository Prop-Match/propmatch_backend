import { OwnerOfferStatus, PropertyType } from 'generated/prisma/client';
import { MatchReason } from './match-reason.dto';

/**
 * GET /landlord/requests item shape (mirrors the frontend's
 * BrowsableTenantRequestSchema in src/lib/api/contracts/tenantRequest.ts).
 */
export interface BrowsableTenantRequestResponseItem {
  id: string;
  minBudget: number;
  maxBudget: number;
  preferredLocations: string;
  propertyType: PropertyType;
  requiredBedrooms: number;
  needsFurnished: boolean;
  flexibilityScore: number;
  lifestyleRequirements: string;
  createdAt: string;
  matchScore: number | null;
  /** Explainability — why the best matching property scored the way it did. */
  matchReasons?: MatchReason[];
  alreadyOffered: boolean;
  bestMatchingProperty: { id: string; title: string } | null;
}

/**
 * GET /tenant/offers item shape (mirrors the frontend's ReceivedOfferSchema
 * in src/lib/api/contracts/offer.ts).
 */
export interface ReceivedOfferResponseItem {
  id: string;
  tenantRequestId: string;
  pitchMessage: string;
  proposedPrice: number;
  status: OwnerOfferStatus;
  matchScore: number | null;
  /** Explainability — why this offer's property scored the way it did. */
  matchReasons?: MatchReason[];
  createdAt: string;
  ownerName: string | null;
  ownerPhoneNumber: string | null;
  manualAddress: string | null;
  matchConnectionId: string | null;
}
