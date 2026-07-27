CREATE TYPE "OwnerPlan" AS ENUM ('FREE', 'PREMIUM');

ALTER TABLE "user_quota"
  ADD COLUMN IF NOT EXISTS "plan_type" TEXT NOT NULL DEFAULT 'FREE',
  ADD COLUMN IF NOT EXISTS "plan_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "max_active_listings" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "user_quota"
  ALTER COLUMN "plan_type" DROP DEFAULT,
  ALTER COLUMN "plan_type" TYPE "OwnerPlan"
    USING (
      CASE
        WHEN "plan_type" = 'PREMIUM'
             AND ("plan_expires_at" IS NULL OR "plan_expires_at" > NOW())
          THEN 'PREMIUM'
        ELSE 'FREE'
      END
    )::"OwnerPlan",
  ALTER COLUMN "plan_type" SET DEFAULT 'FREE',
  ALTER COLUMN "free_listings_left" SET DEFAULT 0,
  ALTER COLUMN "optimizer_uses_left" SET DEFAULT 0,
  ADD COLUMN "documentation_pack_credits" INTEGER NOT NULL DEFAULT 0;

UPDATE "user_quota"
SET "plan_type" = 'FREE',
    "plan_expires_at" = NULL,
    "max_active_listings" = 1
WHERE "plan_type" <> 'PREMIUM'
   OR ("plan_expires_at" IS NOT NULL AND "plan_expires_at" <= NOW());

UPDATE "user_quota"
SET "free_listings_left" = 0;

ALTER TABLE "property"
  ADD COLUMN "boosted_until" TIMESTAMP(3);

UPDATE "property"
SET "boosted_until" = NOW() + INTERVAL '7 days'
WHERE "is_boosted" = TRUE;

ALTER TABLE "payment_transaction"
  ADD COLUMN "target_property_id" UUID;

ALTER TYPE "PaymentType" RENAME TO "PaymentType_previous";
CREATE TYPE "PaymentType" AS ENUM (
  'PREMIUM_OWNER',
  'BOOST_LISTING',
  'AI_ADDON',
  'DOCS_PACK',
  'LEGACY_OWNER_PLUS',
  'LEGACY_NEW_LISTING',
  'LEGACY_BOOST_LISTING',
  'LEGACY_REFILL_MATCHES',
  'LEGACY_OFFER_PACK'
);

ALTER TABLE "payment_transaction"
  ALTER COLUMN "payment_type" TYPE "PaymentType"
  USING (
    CASE "payment_type"::text
      WHEN 'OWNER_PLUS' THEN 'LEGACY_OWNER_PLUS'
      WHEN 'NEW_LISTING' THEN 'LEGACY_NEW_LISTING'
      WHEN 'BOOST_LISTING' THEN 'LEGACY_BOOST_LISTING'
      WHEN 'REFILL_MATCHES' THEN 'LEGACY_REFILL_MATCHES'
      WHEN 'OFFER_PACK' THEN 'LEGACY_OFFER_PACK'
      ELSE "payment_type"::text
    END
  )::"PaymentType";

DROP TYPE "PaymentType_previous";
