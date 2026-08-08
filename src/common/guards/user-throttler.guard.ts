import { Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';

/**
 * Per-user rate limiting for the LLM/AI endpoints (legal chat, support chat,
 * listing-description optimizer). These call an external model on every request
 * and — unlike most routes — are not otherwise capped, so an authenticated
 * account could otherwise fan out unbounded LLM round-trips.
 *
 * Keys the throttle window on the authenticated user id (set by JwtAuthGuard,
 * which runs first) and falls back to the client IP for the unauthenticated
 * edge case, so the limit follows the account rather than a shared NAT IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { userId?: string } | undefined;
    if (user?.userId) return Promise.resolve(`user:${user.userId}`);
    const ip = (req.ip as string | undefined) ?? 'unknown';
    return Promise.resolve(`ip:${ip}`);
  }

  protected throwThrottlingException(): Promise<void> {
    // Arabic, matching the platform's user-facing error language.
    throw new ThrottlerException(
      'لقد أرسلت طلبات كثيرة خلال وقت قصير. برجاء الانتظار قليلاً ثم المحاولة مرة أخرى.',
    );
  }
}
