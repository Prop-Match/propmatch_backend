-- The customer-support module (src/customer-support) was committed on this
-- branch with a richer SupportTicket/SupportMessage shape (priority,
-- escalationReason, aiSummary, authorType/authorName) than the earlier
-- support_ticket/support_message tables already present in this local dev
-- DB (created while testing a separate branch's simpler design against the
-- same shared Postgres instance). This migration alters the existing
-- tables in place instead of dropping/recreating them, backfilling
-- author_name for the handful of existing local rows rather than losing
-- them.

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT', 'CRITICAL');

-- AlterTable: support_ticket
ALTER TABLE "support_ticket"
  ADD COLUMN "escalation_reason" TEXT,
  ADD COLUMN "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "ai_summary" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- "subject" (NOT NULL) is a leftover column from a different branch's
-- design and isn't declared in this branch's SupportTicket model at all —
-- left in place (not dropped) since which of subject/aiSummary the team
-- wants is exactly the cross-branch reconciliation left for later, but
-- relaxed to nullable so ticket creation doesn't hit a NOT NULL violation
-- in the meantime.
ALTER TABLE "support_ticket" ALTER COLUMN "subject" DROP NOT NULL;

-- AlterTable: support_message — rename author -> authorType (same enum, no
-- data loss). Note: authorType has no @map in the Prisma model, so Prisma
-- expects the literal camelCase column name here, unlike every other
-- column in this schema (which are all snake_case via @map).
ALTER TABLE "support_message" RENAME COLUMN "author" TO "authorType";

ALTER TABLE "support_message" ADD COLUMN "author_name" TEXT;

UPDATE "support_message" sm
SET "author_name" = CASE
  WHEN sm."authorType" = 'AI' THEN 'المساعد الذكي'
  WHEN sm."authorType" = 'ADMIN' THEN COALESCE(
    (SELECT u.full_name FROM "user" u WHERE u.id = sm.author_id),
    'مشرف'
  )
  WHEN sm."authorType" = 'USER' THEN COALESCE(
    (SELECT tu.full_name FROM support_ticket st JOIN "user" tu ON tu.id = st.user_id WHERE st.id = sm.ticket_id),
    'مستخدم'
  )
END;

ALTER TABLE "support_message" ALTER COLUMN "author_name" SET NOT NULL;

-- CreateIndex
CREATE INDEX "support_ticket_user_id_updated_at_idx" ON "support_ticket"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "support_ticket_assigned_admin_id_status_idx" ON "support_ticket"("assigned_admin_id", "status");
