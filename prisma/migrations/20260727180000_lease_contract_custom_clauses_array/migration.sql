-- The Hybrid Contract Builder tracks custom clauses as a numbered list
-- (one per user-added block), not a single free-text blob. Table is empty
-- (no working generation path existed until this feature), so this is a
-- plain type change, no backfill needed.
ALTER TABLE "lease_contract"
  ALTER COLUMN "custom_clauses" DROP DEFAULT,
  ALTER COLUMN "custom_clauses" TYPE TEXT[] USING ARRAY[]::TEXT[],
  ALTER COLUMN "custom_clauses" SET NOT NULL,
  ALTER COLUMN "custom_clauses" SET DEFAULT ARRAY[]::TEXT[];
