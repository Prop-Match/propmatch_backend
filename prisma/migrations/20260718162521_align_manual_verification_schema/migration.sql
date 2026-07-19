ALTER TYPE "VerificationStatus" ADD VALUE 'RESUBMISSION_REQUIRED';

ALTER TABLE "identity_verification"
RENAME COLUMN "national_id_front_url"
TO "national_id_front_object_key";

ALTER TABLE "identity_verification"
RENAME COLUMN "national_id_back_url"
TO "national_id_back_object_key";

ALTER TABLE "identity_verification"
RENAME COLUMN "selfie_url"
TO "selfie_object_key";

ALTER TABLE "identity_verification"
ALTER COLUMN "national_id" DROP NOT NULL;

ALTER TABLE "identity_verification"
ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
