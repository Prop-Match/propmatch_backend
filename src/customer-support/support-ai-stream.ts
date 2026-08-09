import { SupportPriority } from '@generated/prisma/enums';

export const ESCALATION_SUCCESS_MESSAGE =
  'تم إنشاء تذكرة دعم وتحويل طلبك إلى موظف مختص. يمكنك متابعة التذكرة الآن.';
export const ESCALATION_FAILURE_MESSAGE =
  'تعذر إنشاء تذكرة الدعم تلقائياً. حاول مرة أخرى أو استخدم زر التحويل لموظف الدعم.';

interface EscalationIntent {
  type: 'done';
  id: string;
  escalated: true;
  escalationReason: string;
  priority: SupportPriority;
  [key: string]: unknown;
}

interface EscalationResult {
  ticketId: string;
}

type CreateEscalation = (intent: EscalationIntent) => Promise<EscalationResult>;
const ALLOWED_ESCALATION_PRIORITIES: SupportPriority[] = [
  SupportPriority.NORMAL,
  SupportPriority.HIGH,
  SupportPriority.URGENT,
];

export function encodeSse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function parseSsePayload(frame: string): Record<string, unknown> | null {
  const dataLine = frame
    .split('\n')
    .find((line) => line.trimStart().startsWith('data:'));
  if (!dataLine) return null;

  try {
    const parsed: unknown = JSON.parse(
      dataLine.slice(dataLine.indexOf(':') + 1),
    );
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isEscalationIntent(
  payload: Record<string, unknown>,
): payload is EscalationIntent {
  return (
    payload.type === 'done' &&
    payload.escalated === true &&
    typeof payload.id === 'string' &&
    typeof payload.escalationReason === 'string' &&
    ALLOWED_ESCALATION_PRIORITIES.includes(payload.priority as SupportPriority)
  );
}

/** Transform one upstream SSE frame, executing a handoff before reporting it. */
export async function transformSupportSseFrame(
  frame: string,
  createEscalation: CreateEscalation,
): Promise<string[]> {
  const payload = parseSsePayload(frame);
  if (!payload || !isEscalationIntent(payload)) return [`${frame}\n\n`];

  try {
    const ticket = await createEscalation(payload);
    return [
      encodeSse({ type: 'token', value: ESCALATION_SUCCESS_MESSAGE }),
      encodeSse({ ...payload, escalated: true, ticketId: ticket.ticketId }),
    ];
  } catch {
    const safeDone = Object.fromEntries(
      Object.entries(payload).filter(
        ([key]) => key !== 'escalationReason' && key !== 'priority',
      ),
    );
    return [
      encodeSse({ type: 'token', value: ESCALATION_FAILURE_MESSAGE }),
      encodeSse({ ...safeDone, escalated: false }),
    ];
  }
}
