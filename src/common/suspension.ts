/**
 * Account-suspension shared logic — used by the admin service (to suspend) and
 * the auth layer (to block). A user is suspended when `suspendedAt` is set and
 * the window is still open: `suspendedUntil === null` means permanent, a future
 * date means temporary (it auto-expires once that date passes, no cron needed).
 */

/** Preset violation reasons the admin picks from, with their Arabic labels. */
export const SUSPENSION_REASONS = {
  SPAM: 'رسائل مزعجة أو إعلانات مكررة',
  FRAUD: 'احتيال أو نصب',
  FAKE_LISTING: 'إعلان وهمي أو بيانات مضللة',
  HARASSMENT: 'تحرش أو إساءة تجاه المستخدمين',
  IDENTITY_ABUSE: 'انتحال هوية أو إساءة استخدام التوثيق',
  TERMS_VIOLATION: 'مخالفة شروط الاستخدام',
  OTHER: 'أخرى',
} as const;

export type SuspensionReasonCode = keyof typeof SUSPENSION_REASONS;

export const SUSPENSION_REASON_CODES = Object.keys(
  SUSPENSION_REASONS,
) as SuspensionReasonCode[];

/** Allowed temporary durations (days). `null` duration = permanent. */
export const SUSPENSION_DURATION_DAYS = [1, 3, 7, 30] as const;
export type SuspensionDurationDays = (typeof SUSPENSION_DURATION_DAYS)[number];

export interface SuspensionState {
  suspendedAt: Date | null;
  suspendedUntil: Date | null;
  suspensionReason: string | null;
}

/** True while the suspension window is open (permanent, or not yet expired). */
export function isSuspensionActive(
  user: Pick<SuspensionState, 'suspendedAt' | 'suspendedUntil'>,
  now: Date = new Date(),
): boolean {
  if (!user.suspendedAt) return false;
  if (user.suspendedUntil === null) return true; // permanent
  return user.suspendedUntil.getTime() > now.getTime();
}

function reasonLabel(reason: string | null): string {
  if (!reason) return 'مخالفة قواعد المنصة';
  return SUSPENSION_REASONS[reason as SuspensionReasonCode] ?? reason;
}

/** User-facing Arabic block message (reason + end date), shown on login/requests. */
export function suspensionMessage(user: SuspensionState): string {
  const reason = reasonLabel(user.suspensionReason);
  if (user.suspendedUntil === null) {
    return `تم إيقاف حسابك نهائيًا. السبب: ${reason}. للاعتراض تواصل مع الدعم.`;
  }
  const date = user.suspendedUntil.toISOString().slice(0, 10);
  return `تم إيقاف حسابك حتى ${date}. السبب: ${reason}.`;
}
