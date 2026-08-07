-- Tracks whether/when a message body was edited after being sent.
ALTER TABLE "message" ADD COLUMN "edited_at" TIMESTAMP(3);
