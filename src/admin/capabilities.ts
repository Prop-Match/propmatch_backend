import { AdminRole } from 'generated/prisma/enums';

/**
 * Fine-grained admin capabilities. Server-side source of truth mirroring the
 * frontend `ROLE_CAPABILITIES` (contracts/admin.ts). The frontend hides UI by
 * capability; this module is what actually ENFORCES it (see CapabilitiesGuard).
 */
export type Capability =
  | 'property:approve'
  | 'property:reject'
  | 'kyc:review'
  | 'request:approve'
  | 'request:reject'
  | 'review:moderate'
  | 'payment:view'
  | 'partner_lead:view'
  | 'report:export'
  | 'ticket:reply'
  | 'audit:view'
  | 'user:suspend'
  | 'admin:create'
  | 'admin:manage'
  | 'user:delete'
  | 'user:reactivate';

const SUPER_ADMIN_CAPS: Capability[] = [
  'property:approve',
  'property:reject',
  'kyc:review',
  'request:approve',
  'request:reject',
  'review:moderate',
  'payment:view',
  'partner_lead:view',
  'report:export',
  'ticket:reply',
  'audit:view',
  'user:suspend',
  'admin:create',
  'admin:manage',
  'user:delete',
  'user:reactivate',
];

export const ROLE_CAPABILITIES: Record<AdminRole, Capability[]> = {
  SUPER_ADMIN: SUPER_ADMIN_CAPS,
  LISTINGS_MANAGER: ['property:approve', 'property:reject'],
  KYC_REVIEWER: ['kyc:review'],
  FINANCE_ADMIN: ['payment:view', 'partner_lead:view', 'report:export'],
  REVIEWS_MANAGER: ['review:moderate', 'request:approve', 'request:reject'],
  CUSTOMER_SUPPORT: ['ticket:reply'],
  READ_ONLY: [],
};

/** Prisma enum → frontend kebab-case slug (what the UI/contract uses). */
export const ADMIN_ROLE_SLUG: Record<AdminRole, string> = {
  SUPER_ADMIN: 'super-admin',
  LISTINGS_MANAGER: 'listings-manager',
  KYC_REVIEWER: 'kyc-reviewer',
  FINANCE_ADMIN: 'finance-admin',
  REVIEWS_MANAGER: 'reviews-manager',
  CUSTOMER_SUPPORT: 'customer-support',
  READ_ONLY: 'read-only',
};

export const ADMIN_ROLE_LABEL: Record<AdminRole, string> = {
  SUPER_ADMIN: 'مشرف عام',
  LISTINGS_MANAGER: 'مدير العقارات',
  KYC_REVIEWER: 'مراجع التوثيق',
  FINANCE_ADMIN: 'مدير مالي',
  REVIEWS_MANAGER: 'مدير التقييمات',
  CUSTOMER_SUPPORT: 'دعم العملاء',
  READ_ONLY: 'اطّلاع فقط',
};

/** NULL adminRole ⇒ SUPER_ADMIN (backward-compat for pre-migration admins). */
export function capabilitiesFor(
  adminRole: AdminRole | null | undefined,
): Capability[] {
  return ROLE_CAPABILITIES[adminRole ?? AdminRole.SUPER_ADMIN];
}

export function roleSlugFor(adminRole: AdminRole | null | undefined): string {
  return ADMIN_ROLE_SLUG[adminRole ?? AdminRole.SUPER_ADMIN];
}

export function roleLabelFor(adminRole: AdminRole | null | undefined): string {
  return ADMIN_ROLE_LABEL[adminRole ?? AdminRole.SUPER_ADMIN];
}

/** Frontend kebab slug → Prisma enum (for writes). Returns null if unknown. */
export function adminRoleFromSlug(slug: string): AdminRole | null {
  const match = (Object.keys(ADMIN_ROLE_SLUG) as AdminRole[]).find(
    (key) => ADMIN_ROLE_SLUG[key] === slug,
  );
  return match ?? null;
}
