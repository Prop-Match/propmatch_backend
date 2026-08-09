export const MAIL_QUEUE = 'mail-notifications';
export const SEND_MAIL_JOB = 'send-mail';

export type MailJobData =
  | { kind: 'PASSWORD_RESET'; to: string; token: string }
  | { kind: 'EMAIL_VERIFICATION_OTP'; to: string; name: string; code: string }
  | {
      kind: 'KYC_REVIEW';
      to: string;
      name: string;
      approved: boolean;
      reason?: string;
    }
  | {
      kind: 'PROPERTY_REVIEW';
      to: string;
      name: string;
      approved: boolean;
      propertyId: string;
      propertyTitle: string;
      reason?: string;
    }
  | {
      kind: 'TENANT_REQUEST_REVIEW';
      to: string;
      name: string;
      approved: boolean;
      reason?: string;
    }
  | {
      kind: 'USER_REVIEW_DECISION';
      to: string;
      name: string;
      approved: boolean;
      propertyId: string;
      reason?: string;
    }
  | {
      kind: 'ACCOUNT_SUSPENDED';
      to: string;
      name: string;
      reason: string;
      note?: string;
      suspendedUntil?: string;
    }
  | { kind: 'ACCOUNT_UNSUSPENDED'; to: string; name: string }
  | { kind: 'ACCOUNT_DELETED'; to: string; name: string }
  | { kind: 'ACCOUNT_REACTIVATED'; to: string; name: string }
  | { kind: 'ACCOUNT_REACTIVATION_REJECTED'; to: string; name: string }
  | {
      kind: 'SUPPORT_REPLY';
      to: string;
      name: string;
      ticketId: string;
      preview: string;
    }
  | {
      kind: 'ADMIN_WELCOME';
      to: string;
      name: string;
      roleLabel: string;
    }
  | {
      kind: 'ADMIN_ACCOUNT_UPDATED';
      to: string;
      name: string;
      roleLabel: string;
      disabled: boolean;
    };
