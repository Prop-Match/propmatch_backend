import { PropertySummaryResponse } from '../mappers/property.mapper';

/** A public property summary enriched only with normalized cosine similarity. */
export interface SemanticPropertySearchItem extends PropertySummaryResponse {
  /** Cosine similarity in the inclusive -1 to 1 range; higher is better. */
  semanticSimilarity: number;
}

export type SemanticSearchEmptyReason = 'NO_RELEVANT_SEMANTIC_MATCH';

/** Public response contract for GET /api/properties/search/semantic. */
export interface SemanticPropertySearchResponse {
  items: SemanticPropertySearchItem[];
  /** Kept for backward compatibility; always equals resultCount for this endpoint. */
  total: number;
  /** The number of property items actually returned. */
  resultCount: number;
  page: 1;
  pageSize: number;
  /** Present only for a successful semantic search with no relevant result. */
  reason?: SemanticSearchEmptyReason;
}
