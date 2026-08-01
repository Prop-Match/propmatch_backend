/**
 * Local, in-memory vector math for the hybrid matcher's worker — deliberately
 * has no network/DB calls. Property vectors are read straight off the
 * `Property.embedding` column (cached at approval time) so scoring a whole
 * candidate batch never round-trips to ChromaDB.
 */

/**
 * Cosine similarity in [-1, 1]. Returns null (not 0) for anything that can't
 * be compared honestly — empty vectors, dimension mismatch (e.g. one vector
 * came from Cohere and the other from the local fallback model), or a
 * zero-magnitude vector — so callers can distinguish "no signal" from
 * "confirmed dissimilar" and fall back to the rule-based score instead of
 * silently scoring it as a bad match.
 */
export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return null;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return null;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
