-- Purely additive enum values for the reactivation-approved/rejected
-- user-facing notifications.
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_REACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_REACTIVATION_REJECTED';
