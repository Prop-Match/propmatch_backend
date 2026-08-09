import { PropertyType } from 'generated/prisma/client';

import {
  SemanticMatchReason,
  SemanticMatchReasonCode,
} from './dto/semantic-property-search-response.dto';

export const MAX_SEMANTIC_MATCH_REASONS = 3;

type SemanticReasonProperty = {
  city: { nameAr: string; nameEn: string } | null;
  district: string;
  propertyType: PropertyType;
  bedrooms: number;
  isFurnished: boolean;
};

const REASON_TEXT: Record<SemanticMatchReasonCode, string> = {
  LOCATION_MENTION_MATCH: 'الموقع المذكور في البحث يطابق موقع العقار',
  PROPERTY_TYPE_MENTION_MATCH: 'نوع العقار المذكور في البحث يطابق هذا العقار',
  BEDROOM_MENTION_MATCH: 'عدد الغرف المذكور في البحث يناسب هذا العقار',
  FURNISHING_MENTION_MATCH: 'العقار مفروش كما ورد في البحث',
  MATCHES_SEARCH_INTENT: 'يتوافق مع تفاصيل البحث والتفضيلات المكتوبة',
};

const PROPERTY_TYPE_TERMS: Record<PropertyType, string[]> = {
  APARTMENT: ['apartment', 'flat', 'شقة', 'شقه'],
  VILLA: ['villa', 'فيلا'],
  STUDIO: ['studio', 'استوديو', 'استديو'],
};

/** Normalizes Arabic variants and English casing for bounded phrase matching. */
export function normalizeSemanticReasonText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function containsTerm(query: string, term: string): boolean {
  const normalizedQuery = normalizeSemanticReasonText(query);
  const normalizedTerm = normalizeSemanticReasonText(term);
  return (
    normalizedTerm.length > 0 &&
    ` ${normalizedQuery} `.includes(` ${normalizedTerm} `)
  );
}

/** Extract an explicit minimum bedroom requirement from Arabic or English text. */
export function requestedBedroomCount(query: string): number | undefined {
  const normalized = normalizeSemanticReasonText(query)
    .replace(/[٠]/g, '0')
    .replace(/[١]/g, '1')
    .replace(/[٢]/g, '2')
    .replace(/[٣]/g, '3')
    .replace(/[٤]/g, '4')
    .replace(/[٥]/g, '5');
  const wordCounts: Array<[number, string]> = [
    [1, 'غرفه'],
    [2, 'غرفتين'],
    [2, 'غرفتان'],
    [2, 'اثنين غرف'],
    [2, 'اثنتين غرف'],
    [3, 'ثلاث غرف'],
    [4, 'اربع غرف'],
    [5, 'خمس غرف'],
  ];
  const numeric = normalized.match(
    /(?:^|\s)([1-5])\s*(?:bedrooms?|rooms?|غرفه?|غرف)(?:\s|$)/,
  );
  if (numeric) return Number(numeric[1]);
  return wordCounts.find(([, phrase]) => containsTerm(normalized, phrase))?.[0];
}

/**
 * Extract an explicit upper monthly-rent limit. The semantic model ranks by
 * intent, but a phrase such as "بحد أقصى 6000" is a hard user constraint and
 * must never be treated as merely a soft similarity signal.
 */
export function requestedMaximumRent(query: string): number | undefined {
  const normalized = normalizeSemanticReasonText(query)
    .replace(/[٠]/g, '0')
    .replace(/[١]/g, '1')
    .replace(/[٢]/g, '2')
    .replace(/[٣]/g, '3')
    .replace(/[٤]/g, '4')
    .replace(/[٥]/g, '5')
    .replace(/[٦]/g, '6')
    .replace(/[٧]/g, '7')
    .replace(/[٨]/g, '8')
    .replace(/[٩]/g, '9');
  const match = normalized.match(
    /(?:بحد\s*اقصي|حد\s*اقصي|لا\s*يزيد\s*عن|حتى|اقل\s*من|max(?:imum)?|up\s*to|under)\s*(\d{3,7})/,
  );
  return match ? Number(match[1]) : undefined;
}

/** Returns a query-derived furnishing constraint only when wording is explicit. */
export function detectFurnishingPreference(query: string): boolean | undefined {
  const unfurnishedTerms = [
    'unfurnished',
    'not furnished',
    'غير مفروش',
    'غير مفروشة',
    'غير مفروشه',
    'بدون فرش',
  ];
  if (unfurnishedTerms.some((term) => containsTerm(query, term))) {
    return false;
  }

  return ['furnished', 'مفروش', 'مفروشة', 'مفروشه'].some((term) =>
    containsTerm(query, term),
  )
    ? true
    : undefined;
}

export function propertyLocationMatches(
  query: string,
  property: Pick<SemanticReasonProperty, 'city' | 'district'>,
): boolean {
  return [property.city?.nameAr, property.city?.nameEn, property.district]
    .filter((value): value is string => Boolean(value?.trim()))
    .some((location) => containsTerm(query, location));
}

export function propertyTypeMatches(
  query: string,
  propertyType: PropertyType,
): boolean {
  return PROPERTY_TYPE_TERMS[propertyType].some((term) =>
    containsTerm(query, term),
  );
}

/** Returns a query-derived property type only when wording is explicit. */
export function detectPropertyTypePreference(
  query: string,
): PropertyType | undefined {
  const normalizedQuery = normalizeSemanticReasonText(query);
  return (Object.keys(PROPERTY_TYPE_TERMS) as PropertyType[]).find(
    (propertyType) => propertyTypeMatches(normalizedQuery, propertyType),
  );
}

/**
 * Produces bounded, deterministic explanations from only the query and hydrated
 * property facts. It intentionally has no provider calls or scoring behavior.
 */
export function buildSemanticMatchReasons(
  query: string,
  property: SemanticReasonProperty,
): SemanticMatchReason[] {
  const reasons: SemanticMatchReasonCode[] = [];
  const normalizedQuery = normalizeSemanticReasonText(query);

  if (propertyLocationMatches(normalizedQuery, property)) {
    reasons.push('LOCATION_MENTION_MATCH');
  }
  if (propertyTypeMatches(normalizedQuery, property.propertyType)) {
    reasons.push('PROPERTY_TYPE_MENTION_MATCH');
  }
  const bedrooms = requestedBedroomCount(normalizedQuery);
  if (bedrooms !== undefined && property.bedrooms >= bedrooms) {
    reasons.push('BEDROOM_MENTION_MATCH');
  }
  if (
    property.isFurnished &&
    detectFurnishingPreference(normalizedQuery) === true
  ) {
    reasons.push('FURNISHING_MENTION_MATCH');
  }
  // semanticSearch calls this only after the configured similarity threshold.
  reasons.push('MATCHES_SEARCH_INTENT');

  return reasons.slice(0, MAX_SEMANTIC_MATCH_REASONS).map((code) => ({
    code,
    text: REASON_TEXT[code],
  }));
}
