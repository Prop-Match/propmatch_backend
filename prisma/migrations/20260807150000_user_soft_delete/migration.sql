-- Soft-delete support for admin user deletion. Purely additive.
ALTER TYPE "TenantRequestStatus" ADD VALUE 'ARCHIVED';

ALTER TABLE "user" ADD COLUMN "deleted_at" TIMESTAMP(3);
