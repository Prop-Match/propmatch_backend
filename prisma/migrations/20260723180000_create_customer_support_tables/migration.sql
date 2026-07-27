-- Establish the base customer-support schema before the richer follow-up
-- migration alters it. IF NOT EXISTS keeps this safe for development
-- databases where an earlier branch created these objects manually.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TicketStatus') THEN
    CREATE TYPE "TicketStatus" AS ENUM (
      'NEW',
      'ASSIGNED',
      'IN_PROGRESS',
      'WAITING',
      'CLOSED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupportAuthor') THEN
    CREATE TYPE "SupportAuthor" AS ENUM ('AI', 'USER', 'ADMIN');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "support_ticket" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "subject" TEXT NOT NULL,
  "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
  "assigned_admin_id" UUID,
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "support_ticket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_ticket_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_ticket_assigned_admin_id_fkey"
    FOREIGN KEY ("assigned_admin_id") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "support_message" (
  "id" UUID NOT NULL,
  "ticket_id" UUID NOT NULL,
  "author" "SupportAuthor" NOT NULL,
  "author_id" UUID,
  "content" TEXT NOT NULL,
  "internal" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "support_message_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_message_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "support_ticket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "support_message_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "support_ticket_status_last_message_at_idx"
  ON "support_ticket"("status", "last_message_at");

CREATE INDEX IF NOT EXISTS "support_message_ticket_id_created_at_idx"
  ON "support_message"("ticket_id", "created_at");
