import { Property, TenantRequest } from 'generated/prisma/client';
import { MatchReason } from '../offers/dto/match-reason.dto';

/**
 * Explainability for the hybrid matcher (Smart Matchmaker). Named separately
 * from properties/semantic-match-reasons.ts — that one parses a free-text
 * search query against a single property; this one compares two structured
 * rows (TenantRequest + Property) already loaded by the worker, so the
 * detection logic doesn't need text parsing at all.
 *
 * Text is Arabic to match every other user-facing reason/notification string
 * in this codebase (AGENTS.md's 100%-Arabic-UI rule) even though the
 * `WITHIN_BUDGET`-style codes stay in English — the frontend switches on
 * `code`, never on `text` (requirements.md §6).
 */
const REASON_TEXT: Record<string, string> = {
  WITHIN_BUDGET: 'ضمن نطاق الميزانية المطلوبة',
  PREFERRED_LOCATION: 'يقع في منطقة من ضمن المناطق المفضلة',
  PROPERTY_TYPE_MATCH: 'نوع العقار يطابق الطلب',
  BEDROOMS_MATCH: 'عدد الغرف يفي بالحد الأدنى المطلوب',
  FURNISHING_MATCH: 'حالة الفرش تطابق تفضيل المستأجر',
  SEMANTIC_SIMILARITY: 'تشابه دلالي قوي بين وصف العقار وتفاصيل الطلب',
};

const MAX_HYBRID_MATCH_REASONS = 4;

/**
 * Builds bounded, deterministic reasons from the same structured facts the
 * rule-based scorer reads, plus one semantic reason gated on the same
 * similarity threshold used to accept semantic property-search results.
 */
export function buildHybridMatchReasons(
  request: TenantRequest,
  property: Property,
  semanticSimilarity: number | null,
  semanticMinSimilarity: number,
): MatchReason[] {
  const codes: string[] = [];

  if (
    property.rentAmount >= request.minBudget &&
    property.rentAmount <= request.maxBudget
  ) {
    codes.push('WITHIN_BUDGET');
  }
  if (request.preferredLocations.includes(property.district)) {
    codes.push('PREFERRED_LOCATION');
  }
  if (property.propertyType === request.propertyType) {
    codes.push('PROPERTY_TYPE_MATCH');
  }
  if (property.bedrooms >= request.requiredBedrooms) {
    codes.push('BEDROOMS_MATCH');
  }
  if (!request.needsFurnished || property.isFurnished) {
    codes.push('FURNISHING_MATCH');
  }
  if (
    semanticSimilarity !== null &&
    semanticSimilarity >= semanticMinSimilarity
  ) {
    codes.push('SEMANTIC_SIMILARITY');
  }

  return codes.slice(0, MAX_HYBRID_MATCH_REASONS).map((code) => ({
    code,
    text: REASON_TEXT[code],
  }));
}
