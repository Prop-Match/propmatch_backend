ALTER TABLE "match_connection"
ADD COLUMN "tenant_request_id" UUID,
ADD COLUMN "agreement_reached_at" TIMESTAMP(3);

UPDATE "match_connection" AS match
SET "tenant_request_id" = (
  SELECT offer."tenant_request_id"
  FROM "owner_offer" AS offer
  INNER JOIN "tenant_request" AS request
    ON request."id" = offer."tenant_request_id"
  WHERE offer."owner_id" = match."owner_id"
    AND offer."property_id" = match."property_id"
    AND request."tenant_id" = match."tenant_id"
    AND offer."status" = 'ACCEPTED'
  ORDER BY offer."updated_at" DESC
  LIMIT 1
)
WHERE match."tenant_request_id" IS NULL;

UPDATE "match_connection" AS match
SET "agreement_reached_at" = contract."created_at"
FROM "lease_contract" AS contract
WHERE contract."match_connection_id" = match."id";

UPDATE "match_connection" AS match
SET "agreement_reached_at" = match."updated_at"
FROM "tenant_request" AS request
WHERE request."id" = match."tenant_request_id"
  AND request."status" = 'FULFILLED'
  AND match."agreement_reached_at" IS NULL;

UPDATE "match_connection" AS match
SET "agreement_reached_at" = match."updated_at"
WHERE match."agreement_reached_at" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "tenant_offer" AS offer
    WHERE offer."tenant_id" = match."tenant_id"
      AND offer."owner_id" = match."owner_id"
      AND offer."property_id" = match."property_id"
      AND offer."status" = 'ACCEPTED'
  );

UPDATE "property" AS property
SET "status" = 'ARCHIVED'
FROM "match_connection" AS match
WHERE match."property_id" = property."id"
  AND match."agreement_reached_at" IS NOT NULL
  AND property."status" <> 'ARCHIVED';

CREATE INDEX "match_connection_tenant_request_id_idx"
ON "match_connection"("tenant_request_id");

ALTER TABLE "match_connection"
ADD CONSTRAINT "match_connection_tenant_request_id_fkey"
FOREIGN KEY ("tenant_request_id") REFERENCES "tenant_request"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
