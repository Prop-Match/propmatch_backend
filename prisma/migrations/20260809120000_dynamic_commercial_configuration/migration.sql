ALTER TABLE "payment_transaction"
  ADD COLUMN "catalog_snapshot" JSONB;

CREATE TABLE "product_configuration" (
  "id" UUID NOT NULL,
  "payment_type" "PaymentType" NOT NULL,
  "price_egp" INTEGER NOT NULL,
  "quantity" INTEGER,
  "validity_days" INTEGER,
  "duration_days" INTEGER,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updated_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_configuration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_configuration_payment_type_key"
  ON "product_configuration"("payment_type");

CREATE TABLE "plan_configuration" (
  "id" UUID NOT NULL,
  "plan_type" "OwnerPlan" NOT NULL,
  "active_listings" INTEGER NOT NULL,
  "offers_per_period" INTEGER NOT NULL,
  "ai_uses_per_period" INTEGER NOT NULL,
  "boost_credits_per_period" INTEGER NOT NULL,
  "boost_duration_days" INTEGER NOT NULL,
  "updated_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_configuration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plan_configuration_plan_type_key"
  ON "plan_configuration"("plan_type");

INSERT INTO "product_configuration"
  ("id", "payment_type", "price_egp", "quantity", "validity_days", "duration_days")
VALUES
  ('10000000-0000-4000-8000-000000000001', 'OWNER_PLUS_MONTHLY', 299, NULL, NULL, NULL),
  ('10000000-0000-4000-8000-000000000002', 'OWNER_PLUS_YEARLY', 2990, NULL, NULL, NULL),
  ('10000000-0000-4000-8000-000000000003', 'PREMIUM_MONTHLY', 699, NULL, NULL, NULL),
  ('10000000-0000-4000-8000-000000000004', 'PREMIUM_YEARLY', 6990, NULL, NULL, NULL),
  ('10000000-0000-4000-8000-000000000005', 'EXTRA_LISTING_60D', 99, 1, 60, NULL),
  ('10000000-0000-4000-8000-000000000006', 'OFFERS_10_60D', 49, 10, 60, NULL),
  ('10000000-0000-4000-8000-000000000007', 'BOOST_7D', 79, NULL, NULL, 7),
  ('10000000-0000-4000-8000-000000000008', 'BOOST_14D', 149, NULL, NULL, 14),
  ('10000000-0000-4000-8000-000000000009', 'BOOST_30D', 249, NULL, NULL, 30),
  ('10000000-0000-4000-8000-000000000010', 'AI_USES_10_90D', 39, 10, 90, NULL);

INSERT INTO "plan_configuration"
  ("id", "plan_type", "active_listings", "offers_per_period", "ai_uses_per_period", "boost_credits_per_period", "boost_duration_days")
VALUES
  ('20000000-0000-4000-8000-000000000001', 'FREE', 1, 5, 5, 0, 7),
  ('20000000-0000-4000-8000-000000000002', 'OWNER_PLUS', 3, 30, 10, 1, 7),
  ('20000000-0000-4000-8000-000000000003', 'PREMIUM', 10, 100, 30, 2, 7);
