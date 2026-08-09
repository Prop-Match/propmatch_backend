-- Makes autonomous support handoffs safe to retry. PostgreSQL allows multiple
-- NULL values in a unique column, so manually created tickets are unaffected.
ALTER TABLE "support_ticket"
ADD COLUMN "agent_escalation_key" TEXT;

CREATE UNIQUE INDEX "support_ticket_agent_escalation_key_key"
ON "support_ticket"("agent_escalation_key");
