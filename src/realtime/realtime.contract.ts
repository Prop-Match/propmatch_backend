export const SOCKET_EVENTS = {
  /** A new NOTIFICATION for the authenticated user → their `user:<id>` room. */
  notification: 'notification',
  /** A new moderation item entered a queue → the `admins` room. */
  adminQueueItem: 'admin:queue:item',
  message: 'message',
  supportTicketCreated: 'support:ticket:created',
  supportMessageReceived: 'support:message:received',
  /** Client→server + server→other-party typing relay (match + support chat). */
  typing: 'typing',
} as const;

/** Rooms. One per user; admins additionally share the `admins` room. */
export const ADMIN_ROOM = 'admins';
export const userRoom = (userId: string): string => `user:${userId}`;

export type NotificationType =
  | 'EKYC_APPROVED'
  | 'PROPERTY_APPROVED'
  | 'NEW_MATCH'
  | 'PAYMENT_SUCCESS'
  | 'NEW_REVIEW_SUBMITTED'
  | 'REVIEW_APPROVED'
  | 'NEW_TENANT_REQUEST'
  | 'NEW_OFFER_RECEIVED'
  | 'NEW_MESSAGE'
  | 'CONTRACT_READY_FOR_REVIEW'
  | 'CONTRACT_APPROVED'
  | 'CONTRACT_REJECTED';

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

/** The four admin moderation queues (frontend `QueueItemType`). */
export type QueueItemType = 'kyc' | 'property' | 'request' | 'review' | 'propertyEdit' | 'partner-lead';

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
