import { FormOptimizerService } from './FormOptimizer.service';

describe('FormOptimizerService', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.SBG_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.SBG_API_KEY = originalApiKey;
    jest.restoreAllMocks();
  });

  it('streams a deterministic fallback when the SBG provider is unreachable', async () => {
    process.env.SBG_API_KEY = 'test-key';
    global.fetch = jest.fn().mockRejectedValue(new Error('network unavailable'));
    const chunks: Array<{ type: string; value?: string }> = [];

    await new Promise<void>((resolve, reject) => {
      new FormOptimizerService()
        .optimizeDescriptionStream({
          description: 'شقة هادئة للإيجار',
          city: 'المنصورة',
          bedrooms: 2,
          isFurnished: true,
        })
        .subscribe({
          next: ({ data }) => chunks.push(data),
          error: reject,
          complete: resolve,
        });
    });

    expect(chunks.at(-1)).toEqual({ type: 'done', id: 'complete' });
    expect(chunks.filter(({ type }) => type === 'token')).not.toHaveLength(0);
  });
});
