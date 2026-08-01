/**
 * Explainability payload shared by the rule-based and semantic matching
 * engines (mirrors the frontend's matchReasons field in
 * src/lib/api/contracts/{tenantRequest,offer,match}.ts). Deliberately a plain
 * string code, not a fixed union — rule-based reasons (e.g. WITHIN_BUDGET,
 * QUIET_AREA) and semantic reasons (SemanticMatchReasonCode in
 * properties/dto/semantic-property-search-response.dto.ts) are produced by
 * different engines and merged into one array.
 */
export interface MatchReason {
  code: string;
  text: string;
}
