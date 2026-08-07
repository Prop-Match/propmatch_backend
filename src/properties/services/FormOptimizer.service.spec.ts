import { FormOptimizerService } from './FormOptimizer.service';
import { SbgChatService } from '../../common/services/sbg-chat.service';

describe('FormOptimizerService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('streams a deterministic fallback when the SBG provider is unreachable', async () => {
    const complete = jest
      .fn()
      .mockRejectedValue(new Error('network unavailable'));
    const chunks: Array<{ type: string; value?: string }> = [];

    await new Promise<void>((resolve, reject) => {
      new FormOptimizerService({ complete })
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
