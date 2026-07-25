import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_SEMANTIC_MIN_SIMILARITY,
  SemanticMatchingConfig,
  parseSemanticMinSimilarity,
} from './semantic-matching.config';

describe('SemanticMatchingConfig', () => {
  it('uses the documented default when the environment value is missing', () => {
    expect(new SemanticMatchingConfig(new ConfigService()).minSimilarity).toBe(
      DEFAULT_SEMANTIC_MIN_SIMILARITY,
    );
  });

  it.each(['not-a-number', '', '-1.01', '1.01'])(
    'rejects invalid threshold %p',
    (value) => {
      expect(() => parseSemanticMinSimilarity(value)).toThrow(
        'SEMANTIC_MIN_SIMILARITY',
      );
    },
  );
});
