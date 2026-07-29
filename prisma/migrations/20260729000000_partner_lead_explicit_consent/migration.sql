-- Keep historic routed rows readable while new leads are internal-only.
ALTER TABLE "partner_lead"
  ALTER COLUMN "partner_name" DROP NOT NULL,
  ADD COLUMN "consented_at" TIMESTAMP(3);
