ALTER TABLE "user"
  ADD COLUMN "email_verified_at" TIMESTAMP(3),
  ADD COLUMN "email_otp_hash" TEXT,
  ADD COLUMN "email_otp_expires_at" TIMESTAMP(3),
  ADD COLUMN "email_otp_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "email_otp_sent_at" TIMESTAMP(3);
