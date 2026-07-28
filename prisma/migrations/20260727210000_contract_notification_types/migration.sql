-- Purely additive enum values for the lease-contract handshake's
-- notifications (sent-for-review / approved / rejected).
ALTER TYPE "NotificationType" ADD VALUE 'CONTRACT_READY_FOR_REVIEW';
ALTER TYPE "NotificationType" ADD VALUE 'CONTRACT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'CONTRACT_REJECTED';
