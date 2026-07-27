-- Handshake model: landlord drafts (status=DRAFTING, no PDF yet), sends for
-- review (PENDING_TENANT_APPROVAL, locked from further landlord edits),
-- tenant approves (APPROVED, generated_by_user_id becomes the tenant's id,
-- PDF actually generated then) or rejects back to DRAFTING with a note.
-- National IDs move to nullable since a draft can now exist before either
-- party's eKYC is checked — only enforced at approval time.

-- CreateEnum
CREATE TYPE "LeaseContractStatus" AS ENUM ('DRAFTING', 'PENDING_TENANT_APPROVAL', 'APPROVED');

-- AlterTable
ALTER TABLE "lease_contract"
  ADD COLUMN "change_request_note" TEXT,
  ADD COLUMN "status" "LeaseContractStatus" NOT NULL DEFAULT 'DRAFTING',
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "owner_national_id" DROP NOT NULL,
  ALTER COLUMN "tenant_national_id" DROP NOT NULL;

-- The one existing row already has a real pdf_url from before this
-- migration (generated under the old single-shot flow) — mark it APPROVED
-- so it isn't mistaken for an in-progress draft.
UPDATE "lease_contract" SET "status" = 'APPROVED' WHERE "pdf_url" IS NOT NULL;
