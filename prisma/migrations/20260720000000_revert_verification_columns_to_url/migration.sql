ALTER TABLE "identity_verification"
RENAME COLUMN "national_id_front_object_key"
TO "national_id_front_url";

ALTER TABLE "identity_verification"
RENAME COLUMN "national_id_back_object_key"
TO "national_id_back_url";

ALTER TABLE "identity_verification"
RENAME COLUMN "selfie_object_key"
TO "selfie_url";
