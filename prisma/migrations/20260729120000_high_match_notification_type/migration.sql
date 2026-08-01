-- Smart Matchmaker — purely additive enum value for the proactive
-- "your property scored >75 against a new tenant request" notification.
ALTER TYPE "NotificationType" ADD VALUE 'HIGH_MATCH_TENANT_REQUEST';
