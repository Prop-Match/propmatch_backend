import { Property, TenantRequest } from 'generated/prisma/client';

/**
 * Rule-based stand-in for the real semantic/embeddings matching engine
 * (mirrors src/mocks/router.ts's scoreRequestAgainstProperty on the frontend,
 * so browse ordering and displayed scores stay consistent whichever backend
 * is running against).
 */
export function scoreRequestAgainstProperty(
  request: TenantRequest,
  property: Property,
): number {
  let score = 50;

  if (
    property.rentAmount >= request.minBudget &&
    property.rentAmount <= request.maxBudget
  ) {
    score += 18;
  } else {
    score -= 22;
  }

  if (request.preferredLocations.includes(property.district)) score += 12;
  if (property.propertyType === request.propertyType) score += 8;
  if (property.bedrooms >= request.requiredBedrooms) score += 5;
  if (!request.needsFurnished || property.isFurnished) score += 5;

  const words = request.lifestyleRequirements
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const haystack = `${property.description} ${property.propertyAroundServices ?? ''}`;
  score += Math.min(10, words.filter((w) => haystack.includes(w)).length * 2);

  score += Math.round((request.flexibilityScore - 5) * 0.6);
  if (property.isBoosted) score += 2;

  return Math.max(5, Math.min(98, Math.round(score)));
}
