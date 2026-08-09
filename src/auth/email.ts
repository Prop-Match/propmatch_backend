import type { TransformFnParams } from 'class-transformer';

export const MAX_EMAIL_LENGTH = 254;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeEmailTransform({ value }: TransformFnParams): unknown {
  const input: unknown = value;
  return typeof input === 'string' ? normalizeEmail(input) : input;
}
