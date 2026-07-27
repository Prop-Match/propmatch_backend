-- The base migration includes subject only because the existing enrichment
-- migration expects and relaxes that legacy column. The current Prisma model
-- uses ai_summary instead, so remove subject after the enrichment completes.
ALTER TABLE "support_ticket" DROP COLUMN IF EXISTS "subject";
