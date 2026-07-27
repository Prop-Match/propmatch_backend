import { PropertyType } from '@generated/prisma/enums';

export const TENANT_REQUEST_SUGGESTION_FIELDS = [
  'minBudget',
  'maxBudget',
  'preferredLocations',
  'propertyType',
  'requiredBedrooms',
  'needsFurnished',
  'flexibilityScore',
  'lifestyleRequirements',
] as const;

export type TenantRequestSuggestionField =
  (typeof TENANT_REQUEST_SUGGESTION_FIELDS)[number];

export type TenantRequestSuggestions = {
  minBudget: number | null;
  maxBudget: number | null;
  preferredLocations: string | null;
  propertyType: PropertyType | null;
  requiredBedrooms: number | null;
  needsFurnished: boolean | null;
  flexibilityScore: number | null;
  lifestyleRequirements: string | null;
};

export class TenantRequestExtractionResponseDto {
  originalText: string;
  suggestions: TenantRequestSuggestions;
  missingFields: TenantRequestSuggestionField[];
}
