-- Email verification is required only for accounts created after the OTP flow.
-- Existing accounts have no pending OTP hash and must retain their current access.
UPDATE "user"
SET "email_verified_at" = "created_at"
WHERE "email_verified_at" IS NULL
  AND "email_otp_hash" IS NULL;
