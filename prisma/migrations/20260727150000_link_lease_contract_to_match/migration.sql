-- Ties lease_contract to the match connection it was generated for (one
-- contract per match), so generation can be access-gated to the two real
-- parties of a CONNECTED match instead of accepting arbitrary input.
-- Table is empty (feature had no working generation path yet), so this is
-- a plain NOT NULL add, no backfill needed.

-- AlterTable
ALTER TABLE "lease_contract" ADD COLUMN     "match_connection_id" UUID NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "lease_contract_match_connection_id_key" ON "lease_contract"("match_connection_id");

-- AddForeignKey
ALTER TABLE "lease_contract" ADD CONSTRAINT "lease_contract_match_connection_id_fkey" FOREIGN KEY ("match_connection_id") REFERENCES "match_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
