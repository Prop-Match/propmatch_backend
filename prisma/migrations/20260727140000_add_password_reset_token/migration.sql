-- Password reset (auth/forgot-password) landed via the dev merge with the
-- schema fields but no migration ever generated for them.
-- (Scoped to just this addition — the diff also showed a drop of the
-- leftover, already-unused support_ticket.subject column and default
-- tweaks on support_ticket timestamps; left untouched here since those are
-- a separate, already-flagged reconciliation decision, not part of this fix.)

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "reset_token" TEXT,
ADD COLUMN     "reset_token_expiry" TIMESTAMP(3);
