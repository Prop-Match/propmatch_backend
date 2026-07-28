-- Reconcile fields and tables that existed in prisma/schema.prisma without
-- a corresponding historical migration. Every statement is forward-only.

CREATE TYPE "AdminRole" AS ENUM (
  'SUPER_ADMIN',
  'LISTINGS_MANAGER',
  'KYC_REVIEWER',
  'FINANCE_ADMIN',
  'REVIEWS_MANAGER',
  'CUSTOMER_SUPPORT',
  'READ_ONLY'
);

CREATE TYPE "TenantOfferStatus" AS ENUM (
  'PENDING',
  'COUNTERED',
  'ACCEPTED',
  'DECLINED',
  'WITHDRAWN'
);

CREATE TYPE "MessageAttachmentType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO');

ALTER TYPE "OwnerPlan" ADD VALUE 'OWNER_PLUS';

ALTER TABLE "user" ADD COLUMN "admin_role" "AdminRole";

ALTER TABLE "message"
  ADD COLUMN "attachment_duration_ms" INTEGER,
  ADD COLUMN "attachment_name" TEXT,
  ADD COLUMN "attachment_type" "MessageAttachmentType",
  ADD COLUMN "attachment_url" TEXT;

ALTER TABLE "support_message"
  ADD COLUMN "attachment_duration_ms" INTEGER,
  ADD COLUMN "attachment_name" TEXT,
  ADD COLUMN "attachment_type" "MessageAttachmentType",
  ADD COLUMN "attachment_url" TEXT;

ALTER TABLE "support_ticket"
  ALTER COLUMN "last_message_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "lease_contract"
  ALTER COLUMN "custom_clauses" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE TABLE "tenant_offer" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "message" TEXT NOT NULL,
  "proposed_price" DOUBLE PRECISION NOT NULL,
  "counter_price" DOUBLE PRECISION,
  "counter_message" TEXT,
  "status" "TenantOfferStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_offer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_offer_owner_id_idx" ON "tenant_offer"("owner_id");
CREATE INDEX "tenant_offer_tenant_id_idx" ON "tenant_offer"("tenant_id");

ALTER TABLE "tenant_offer"
  ADD CONSTRAINT "tenant_offer_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "tenant_offer_property_id_fkey"
    FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "tenant_offer_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
