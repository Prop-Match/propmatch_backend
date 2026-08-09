-- Purely additive: admin account-suspension fields, merged in from the
-- `dev` branch's suspend/unsuspend feature (coexists with this branch's
-- soft-delete + reactivation flow — see the User.deletedAt schema comment).
-- No migration existed for these columns on `dev` itself; this is the first
-- one for them.
ALTER TABLE "user" ADD COLUMN "suspended_at" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN "suspended_until" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN "suspension_reason" TEXT;
ALTER TABLE "user" ADD COLUMN "suspension_note" TEXT;
ALTER TABLE "user" ADD COLUMN "suspended_by_id" UUID;
