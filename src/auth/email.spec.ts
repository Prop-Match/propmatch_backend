import { MAX_EMAIL_LENGTH, normalizeEmail } from './email';

describe('email normalization', () => {
  it('trims and lowercases email addresses', () => {
    expect(normalizeEmail('  Mixed.Case@Example.COM  ')).toBe(
      'mixed.case@example.com',
    );
  });

  it('uses the RFC-compatible maximum address length', () => {
    expect(MAX_EMAIL_LENGTH).toBe(254);
  });
});
