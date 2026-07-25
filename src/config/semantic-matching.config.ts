import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const DEFAULT_SEMANTIC_MIN_SIMILARITY = 0.65;

export function parseSemanticMinSimilarity(value: unknown): number {
  if (value === undefined) return DEFAULT_SEMANTIC_MIN_SIMILARITY;

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed < -1 || parsed > 1) {
    throw new Error(
      'SEMANTIC_MIN_SIMILARITY must be a finite number between -1 and 1.',
    );
  }

  return parsed;
}

/** Centralized semantic-search configuration, shared by future matching flows. */
@Injectable()
export class SemanticMatchingConfig {
  readonly minSimilarity: number;

  constructor(configService: ConfigService) {
    this.minSimilarity = parseSemanticMinSimilarity(
      configService.get<unknown>('SEMANTIC_MIN_SIMILARITY'),
    );
  }
}
