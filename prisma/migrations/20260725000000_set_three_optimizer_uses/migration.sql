ALTER TABLE "user_quota"
ALTER COLUMN "optimizer_uses_left" SET DEFAULT 3;

UPDATE "user_quota"
SET "optimizer_uses_left" = 3;
