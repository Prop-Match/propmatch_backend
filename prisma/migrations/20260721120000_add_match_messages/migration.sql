-- CreateTable
CREATE TABLE "message" (
    "id" UUID NOT NULL,
    "match_connection_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_match_connection_id_created_at_idx" ON "message"("match_connection_id", "created_at");

-- CreateIndex
CREATE INDEX "message_sender_id_idx" ON "message"("sender_id");

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_match_connection_id_fkey" FOREIGN KEY ("match_connection_id") REFERENCES "match_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
