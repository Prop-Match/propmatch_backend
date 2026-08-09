-- Accepted commercial catalog SKUs. Legacy enum values remain readable so
-- historical transactions are never rewritten or invalidated.
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'OWNER_PLUS_MONTHLY';
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'OWNER_PLUS_YEARLY';
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'PREMIUM_MONTHLY';
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'PREMIUM_YEARLY';
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'EXTRA_LISTING_60D';
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'OFFERS_10_60D';
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'BOOST_7D';
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'BOOST_14D';
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'BOOST_30D';
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'AI_USES_10_90D';

CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "EntitlementType" AS ENUM ('ACTIVE_LISTING', 'MATCHED_OFFER', 'AI_OPTIMIZER_USE');
CREATE TYPE "EntitlementSource" AS ENUM ('PLAN', 'ADDON', 'MIGRATION');
CREATE TYPE "AnalyticsTrafficSource" AS ENUM ('ORGANIC', 'BOOSTED');
CREATE TYPE "BoostCampaignStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED');

ALTER TABLE "user_quota"
  ADD COLUMN "billing_interval" "BillingInterval",
  ADD COLUMN "current_period_starts_at" TIMESTAMP(3),
  ADD COLUMN "current_period_ends_at" TIMESTAMP(3),
  ADD COLUMN "boost_credits_left" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "listing_grace_ends_at" TIMESTAMP(3),
  ADD COLUMN "pending_plan_type" "OwnerPlan",
  ADD COLUMN "pending_billing_interval" "BillingInterval",
  ADD COLUMN "pending_plan_starts_at" TIMESTAMP(3),
  ADD COLUMN "pending_plan_expires_at" TIMESTAMP(3);

-- Existing users start a fresh non-carrying monthly period at migration time.
UPDATE "user_quota"
SET
  "current_period_starts_at" = CURRENT_TIMESTAMP,
  "current_period_ends_at" = CURRENT_TIMESTAMP + INTERVAL '1 month',
  "last_reset_date" = CURRENT_TIMESTAMP,
  "max_active_listings" = CASE "plan_type"
    WHEN 'PREMIUM' THEN 10
    WHEN 'OWNER_PLUS' THEN 3
    ELSE 1
  END,
  "free_offers_left" = CASE "plan_type"
    WHEN 'PREMIUM' THEN 100
    WHEN 'OWNER_PLUS' THEN 30
    ELSE LEAST("free_offers_left", 5)
  END,
  "optimizer_uses_left" = CASE "plan_type"
    WHEN 'PREMIUM' THEN 30
    WHEN 'OWNER_PLUS' THEN 10
    ELSE LEAST("optimizer_uses_left", 5)
  END,
  "boost_credits_left" = CASE "plan_type"
    WHEN 'PREMIUM' THEN 2
    WHEN 'OWNER_PLUS' THEN 1
    ELSE 0
  END;

ALTER TABLE "payment_transaction"
  ADD COLUMN "product_sku" TEXT,
  ADD COLUMN "billing_interval" "BillingInterval";

CREATE TABLE "entitlement_grant" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "payment_transaction_id" UUID,
  "type" "EntitlementType" NOT NULL,
  "source" "EntitlementSource" NOT NULL DEFAULT 'ADDON',
  "product_sku" TEXT NOT NULL,
  "granted_quantity" INTEGER NOT NULL,
  "remaining_quantity" INTEGER NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "entitlement_grant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "boost_campaign" (
  "id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "payment_transaction_id" UUID,
  "product_sku" TEXT NOT NULL,
  "duration_days" INTEGER NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "status" "BoostCampaignStatus" NOT NULL DEFAULT 'SCHEDULED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "boost_campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "property_view_event" (
  "id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "viewer_id" UUID,
  "visitor_hash" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "traffic_source" "AnalyticsTrafficSource" NOT NULL DEFAULT 'ORGANIC',
  "boost_campaign_id" UUID,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "property_view_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "property_analytics_daily" (
  "id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "views" INTEGER NOT NULL DEFAULT 0,
  "unique_views" INTEGER NOT NULL DEFAULT 0,
  "organic_views" INTEGER NOT NULL DEFAULT 0,
  "boosted_views" INTEGER NOT NULL DEFAULT 0,
  "favorites_added" INTEGER NOT NULL DEFAULT 0,
  "favorites_removed" INTEGER NOT NULL DEFAULT 0,
  "tenant_offers" INTEGER NOT NULL DEFAULT 0,
  "owner_offers" INTEGER NOT NULL DEFAULT 0,
  "matches" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "property_analytics_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "entitlement_grant_payment_transaction_id_type_key"
  ON "entitlement_grant"("payment_transaction_id", "type");
CREATE INDEX "entitlement_grant_user_id_type_expires_at_idx"
  ON "entitlement_grant"("user_id", "type", "expires_at");
CREATE UNIQUE INDEX "boost_campaign_payment_transaction_id_key"
  ON "boost_campaign"("payment_transaction_id");
CREATE INDEX "boost_campaign_property_id_starts_at_ends_at_idx"
  ON "boost_campaign"("property_id", "starts_at", "ends_at");
CREATE INDEX "boost_campaign_user_id_status_idx"
  ON "boost_campaign"("user_id", "status");
CREATE UNIQUE INDEX "property_view_event_dedupe_key_key"
  ON "property_view_event"("dedupe_key");
CREATE INDEX "property_view_event_property_id_occurred_at_idx"
  ON "property_view_event"("property_id", "occurred_at");
CREATE INDEX "property_view_event_property_id_visitor_hash_idx"
  ON "property_view_event"("property_id", "visitor_hash");
CREATE UNIQUE INDEX "property_analytics_daily_property_id_date_key"
  ON "property_analytics_daily"("property_id", "date");
CREATE INDEX "property_analytics_daily_date_idx"
  ON "property_analytics_daily"("date");

ALTER TABLE "entitlement_grant"
  ADD CONSTRAINT "entitlement_grant_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "entitlement_grant_payment_transaction_id_fkey"
  FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "boost_campaign"
  ADD CONSTRAINT "boost_campaign_property_id_fkey"
  FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "boost_campaign_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "boost_campaign_payment_transaction_id_fkey"
  FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "property_view_event"
  ADD CONSTRAINT "property_view_event_property_id_fkey"
  FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "property_view_event_viewer_id_fkey"
  FOREIGN KEY ("viewer_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "property_view_event_boost_campaign_id_fkey"
  FOREIGN KEY ("boost_campaign_id") REFERENCES "boost_campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "property_analytics_daily"
  ADD CONSTRAINT "property_analytics_daily_property_id_fkey"
  FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
