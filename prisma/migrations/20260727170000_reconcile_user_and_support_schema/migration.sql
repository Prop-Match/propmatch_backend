-- Reconcile fields present in the Prisma models but missing from the original
-- migration history. Password-reset lookups require these nullable columns.
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "reset_token" TEXT,
  ADD COLUMN IF NOT EXISTS "reset_token_expiry" TIMESTAMP(3);

-- @updatedAt is maintained by Prisma; it is not a database-level default.
ALTER TABLE "support_ticket"
  ALTER COLUMN "updated_at" DROP DEFAULT;
