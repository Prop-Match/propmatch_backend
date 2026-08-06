import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DefaultJobOptions } from 'bullmq';

export const DEFAULT_MATCHING_JOB_ATTEMPTS = 3;
export const DEFAULT_MATCHING_JOB_BACKOFF_MS = 5000;
export const DEFAULT_MATCHING_REMOVE_ON_COMPLETE_AGE_SECONDS = 60 * 60 * 24; // 24h
export const DEFAULT_MATCHING_REMOVE_ON_COMPLETE_COUNT = 1000;
export const DEFAULT_MATCHING_REMOVE_ON_FAIL_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function parsePositiveInt(
  value: unknown,
  fallback: number,
  varName: string,
): number {
  if (value === undefined) return fallback;

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${varName} must be a positive integer.`);
  }

  return parsed;
}

/**
 * Pre-production hardening for the matching-queue's default job options
 * (see docs/smart-matching-engine-architecture.md §8). Every setting is
 * env-overridable with a documented fallback so nothing here is hardcoded —
 * ops can retune retry/retention behavior per environment without a code
 * change.
 */
@Injectable()
export class MatchingQueueConfig {
  readonly attempts: number;
  readonly backoffDelayMs: number;
  readonly removeOnCompleteAgeSeconds: number;
  readonly removeOnCompleteCount: number;
  readonly removeOnFailAgeSeconds: number;

  constructor(configService: ConfigService) {
    this.attempts = parsePositiveInt(
      configService.get<unknown>('MATCHING_JOB_ATTEMPTS'),
      DEFAULT_MATCHING_JOB_ATTEMPTS,
      'MATCHING_JOB_ATTEMPTS',
    );
    this.backoffDelayMs = parsePositiveInt(
      configService.get<unknown>('MATCHING_JOB_BACKOFF_MS'),
      DEFAULT_MATCHING_JOB_BACKOFF_MS,
      'MATCHING_JOB_BACKOFF_MS',
    );
    this.removeOnCompleteAgeSeconds = parsePositiveInt(
      configService.get<unknown>('MATCHING_REMOVE_ON_COMPLETE_AGE_SECONDS'),
      DEFAULT_MATCHING_REMOVE_ON_COMPLETE_AGE_SECONDS,
      'MATCHING_REMOVE_ON_COMPLETE_AGE_SECONDS',
    );
    this.removeOnCompleteCount = parsePositiveInt(
      configService.get<unknown>('MATCHING_REMOVE_ON_COMPLETE_COUNT'),
      DEFAULT_MATCHING_REMOVE_ON_COMPLETE_COUNT,
      'MATCHING_REMOVE_ON_COMPLETE_COUNT',
    );
    this.removeOnFailAgeSeconds = parsePositiveInt(
      configService.get<unknown>('MATCHING_REMOVE_ON_FAIL_AGE_SECONDS'),
      DEFAULT_MATCHING_REMOVE_ON_FAIL_AGE_SECONDS,
      'MATCHING_REMOVE_ON_FAIL_AGE_SECONDS',
    );
  }

  toDefaultJobOptions(): DefaultJobOptions {
    return {
      attempts: this.attempts,
      backoff: { type: 'exponential', delay: this.backoffDelayMs },
      // BullMQ removeOnComplete/removeOnFail accept {age, count} — age wins
      // as soon as either threshold is hit for removeOnComplete; removeOnFail
      // is age-only here since failed jobs are the debugging trail, not
      // something we also want pruned by a raw count.
      removeOnComplete: {
        age: this.removeOnCompleteAgeSeconds,
        count: this.removeOnCompleteCount,
      },
      removeOnFail: { age: this.removeOnFailAgeSeconds },
    };
  }
}
