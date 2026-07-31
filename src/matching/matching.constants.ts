/** BullMQ queue name for the Smart Matchmaker's background scoring/notification pipeline. */
export const MATCHING_QUEUE = 'matching-queue';

/** Job name for "a tenant request was created/re-approved, find and notify matching landlords". */
export const MATCH_TENANT_REQUEST_JOB = 'match-tenant-request';

/** Payload enqueued by TenantRequestsService — kept minimal, the worker re-fetches fresh state by id. */
export interface MatchTenantRequestJobData {
  tenantRequestId: string;
}

/** A landlord's property must clear this hybrid score to get a proactive notification. */
export const HIGH_MATCH_NOTIFICATION_THRESHOLD = 75;
