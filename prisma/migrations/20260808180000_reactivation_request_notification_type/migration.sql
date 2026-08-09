-- Purely additive enum value for the persisted admin-facing "new
-- reactivation request" notification (bell dropdown).
ALTER TYPE "NotificationType" ADD VALUE 'REACTIVATION_REQUEST';
