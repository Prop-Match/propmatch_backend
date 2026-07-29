CREATE TYPE "TenantContractReviewStatus" AS ENUM ('PENDING_REVIEW', 'CHANGES_REQUESTED', 'REVIEW_CONFIRMED');
ALTER TABLE "lease_contract"
  ADD COLUMN "tenant_review_status" "TenantContractReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN "tenant_change_request" TEXT,
  ADD COLUMN "tenant_change_requested_at" TIMESTAMP(3),
  ADD COLUMN "tenant_review_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "draft_revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "tenant_reviewed_revision" INTEGER;
