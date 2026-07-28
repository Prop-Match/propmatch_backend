-- Optional witness fields for the lease contract (Arabic legal convention:
-- a lease is often countersigned by two witnesses). Nullable — not every
-- contract will have witnesses filled in.
ALTER TABLE "lease_contract"
  ADD COLUMN "witness1_name" TEXT,
  ADD COLUMN "witness1_national_id" TEXT,
  ADD COLUMN "witness2_name" TEXT,
  ADD COLUMN "witness2_national_id" TEXT;
