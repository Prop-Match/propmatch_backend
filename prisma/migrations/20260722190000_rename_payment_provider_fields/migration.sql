-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('PAYMOB');

-- Rename columns (preserves existing data) instead of drop+recreate.
ALTER TABLE "payment_transaction"
RENAME COLUMN "paymob_order_id" TO "provider_order_id";

ALTER TABLE "payment_transaction"
RENAME COLUMN "paymob_transaction_id" TO "provider_transaction_id";

ALTER TABLE "payment_transaction"
ADD COLUMN "provider" "PaymentProvider" NOT NULL DEFAULT 'PAYMOB';

ALTER INDEX "payment_transaction_paymob_order_id_key"
RENAME TO "payment_transaction_provider_order_id_key";
