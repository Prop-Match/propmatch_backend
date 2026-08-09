export const SOCKET_EVENTS = {
  /** A new NOTIFICATION for the authenticated user → their `user:<id>` room. */
  notification: 'notification',
  /** A new moderation item entered a queue → the `admins` room. */
  adminQueueItem: 'admin:queue:item',
  message: 'message',
  /** A match message was edited by its sender → deliver the new body to the peer. */
  messageEdited: 'message:edited',
  /** A match message was deleted by its sender → remove it from the peer's view. */
  messageDeleted: 'message:deleted',
  supportTicketCreated: 'support:ticket:created',
  supportMessageReceived: 'support:message:received',
  /** A persisted payment reached SUCCESS or FAILED for its authenticated owner. */
  paymentUpdated: 'payment:updated',
  /** Client→server + server→other-party typing relay (match + support chat). */
  typing: 'typing',
  /** A soft-deleted user's live socket must drop immediately. */
  forceLogout: 'force_logout',
  /** A dedicated alert (distinct from the generic admin:queue:item) so the
   * admin bell can toast + refetch without decoding a queue-item shape. */
  newReactivationRequest: 'new_reactivation_request',
  /** Admin suspended this account → push a blocking notice to the live session. */
  accountSuspended: 'account:suspended',
} as const;

export interface AccountSuspendedPayload {
  message: string;
  reason: string | null;
  /** ISO date, or null for a permanent suspension. */
  suspendedUntil: string | null;
}

/** Rooms. One per user; admins additionally share the `admins` room. */
export const ADMIN_ROOM = 'admins';
export const userRoom = (userId: string): string => `user:${userId}`;

export type NotificationType =
  | 'EKYC_APPROVED'
  | 'EKYC_RESUBMISSION_REQUIRED'
  | 'PROPERTY_APPROVED'
  | 'PROPERTY_REJECTED'
  | 'NEW_MATCH'
  | 'PAYMENT_SUCCESS'
  | 'NEW_REVIEW_SUBMITTED'
  | 'REVIEW_APPROVED'
  | 'REVIEW_REJECTED'
  | 'NEW_TENANT_REQUEST'
  | 'TENANT_REQUEST_APPROVED'
  | 'TENANT_REQUEST_REJECTED'
  | 'NEW_OFFER_RECEIVED'
  | 'NEW_MESSAGE'
  | 'CONTRACT_READY_FOR_REVIEW'
  | 'CONTRACT_APPROVED'
  | 'CONTRACT_REJECTED'
  | 'USER_REVIEW_RECEIVED'
  | 'HIGH_MATCH_TENANT_REQUEST'
  | 'ACCOUNT_REACTIVATED'
  | 'ACCOUNT_REACTIVATION_REJECTED'
  | 'REACTIVATION_REQUEST'
  | 'SUPPORT_TICKET_ESCALATED';

export interface NotificationPayload {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface MessagePayload {
  id: string;
  matchConnectionId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

/** The admin moderation queues (frontend `QueueItemType`). */
export type QueueItemType =
  | 'kyc'
  | 'property'
  | 'request'
  | 'review'
  | 'propertyEdit'
  | 'partner-lead'
  // Not yet rendered by any frontend queue widget — see
  // RealtimeService.reactivationRequested's doc comment.
  | 'reactivation';

export interface QueueItem {
  /** Frontend prefixes queue ids with `q_` to keep them distinct from entity ids. */
  id: string;
  type: QueueItemType;
  subjectId: string;
  title: string;
  subtitle: string;
  submittedAt: string;
}

export interface SupportTicketPayload {
  ticketId: string;
  subject: string;
  userName: string;
  priority: string;
  createdAt: string;
}

export interface SupportMessagePayload {
  ticketId: string;
  authorName: string;
  content: string;
  internal: boolean;
  at: string;
}

export interface ReactivationRequestedPayload {
  requestId: string;
  userId: string;
  userFullName: string;
  userEmail: string;
  createdAt: string;
}

export interface PaymentUpdatedPayload {
  providerOrderId: string;
  status: 'SUCCESS' | 'FAILED';
  providerTransactionId: string | null;
  paidAt: string | null;
}
