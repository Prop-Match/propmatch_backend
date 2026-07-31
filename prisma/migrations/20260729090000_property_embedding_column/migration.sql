-- Cached copy of the approval-time embedding vector, stored alongside the
-- row so the hybrid matcher's background worker can pull it in the same SQL
-- query used for the rule-based pre-filter (avoids a per-candidate ChromaDB
-- round-trip; cosine similarity is computed locally in Node memory instead).
ALTER TABLE "property" ADD COLUMN "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[];
