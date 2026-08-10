-- User-to-user reviews are submitted after an approved lease contract.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'USER_REVIEW_RECEIVED';

CREATE TYPE "UserReviewDirection" AS ENUM (
  'TENANT_TO_LANDLORD',
  'LANDLORD_TO_TENANT'
);

CREATE TABLE "user_review" (
  "id" UUID NOT NULL,
  "lease_contract_id" UUID NOT NULL,
  "reviewer_id" UUID NOT NULL,
  "reviewee_id" UUID NOT NULL,
  "direction" "UserReviewDirection" NOT NULL,
  "overall_rating" INTEGER NOT NULL,
  "communication_rating" INTEGER NOT NULL,
  "responsiveness_rating" INTEGER NOT NULL,
  "property_accuracy_rating" INTEGER,
  "commitment_rating" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_review_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_review_distinct_parties_check"
    CHECK ("reviewer_id" <> "reviewee_id"),
  CONSTRAINT "user_review_rating_range_check"
    CHECK (
      "overall_rating" BETWEEN 1 AND 5
      AND "communication_rating" BETWEEN 1 AND 5
      AND "responsiveness_rating" BETWEEN 1 AND 5
      AND (
        "property_accuracy_rating" IS NULL
        OR "property_accuracy_rating" BETWEEN 1 AND 5
      )
      AND (
        "commitment_rating" IS NULL
        OR "commitment_rating" BETWEEN 1 AND 5
      )
    ),
  CONSTRAINT "user_review_direction_metrics_check"
    CHECK (
      (
        "direction" = 'TENANT_TO_LANDLORD'
        AND "property_accuracy_rating" IS NOT NULL
        AND "commitment_rating" IS NULL
      )
      OR (
        "direction" = 'LANDLORD_TO_TENANT'
        AND "commitment_rating" IS NOT NULL
        AND "property_accuracy_rating" IS NULL
      )
    )
);

CREATE UNIQUE INDEX "user_review_lease_contract_id_reviewer_id_key"
  ON "user_review"("lease_contract_id", "reviewer_id");

CREATE INDEX "user_review_reviewee_id_created_at_idx"
  ON "user_review"("reviewee_id", "created_at");

CREATE INDEX "user_review_reviewer_id_idx"
  ON "user_review"("reviewer_id");

ALTER TABLE "user_review"
  ADD CONSTRAINT "user_review_lease_contract_id_fkey"
  FOREIGN KEY ("lease_contract_id") REFERENCES "lease_contract"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "user_review_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "user_review_reviewee_id_fkey"
  FOREIGN KEY ("reviewee_id") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
