import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PropertyEmbeddingService } from './property-embedding.service';

describe('PropertyEmbeddingService', () => {
  const get = jest.fn();
  const service = new PropertyEmbeddingService({ get } as ConfigService);

  beforeEach(() => {
    jest.restoreAllMocks();
    get.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        COHERE_API_KEY: 'test-key',
        COHERE_EMBEDDING_MODEL: 'embed-v4.0',
        COHERE_EMBEDDING_DIMENSION: '1024',
        LOCAL_EMBEDDINGS_URL: 'http://127.0.0.1:8001',
      };
      return values[key];
    });
  });

  it('uses Cohere as the primary embedding provider', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { embeddings: { float: [[0.1, 0.2]] } },
    } as never);

    await expect(
      service.createPrimaryEmbedding('near university', 'search_query'),
    ).resolves.toEqual({ provider: 'cohere', embedding: [0.1, 0.2] });

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.cohere.com/v2/embed',
      expect.objectContaining({
        input_type: 'search_query',
        output_dimension: 1024,
      }),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-key' } }),
    );
  });

  it('uses the local model only after a transient Cohere failure', async () => {
    jest
      .spyOn(axios, 'post')
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 429 } })
      .mockResolvedValueOnce({
        data: {
          embedding: [0.3, 0.4],
          dimension: 2,
          model: 'local-test-model',
        },
      } as never);

    await expect(
      service.createPrimaryEmbedding('near university', 'search_query'),
    ).resolves.toEqual({ provider: 'local', embedding: [0.3, 0.4] });

    expect(axios.post).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8001/embed',
      { text: 'near university' },
      { timeout: 30_000 },
    );
  });

  it('does not hide a missing Cohere key with local fallback', async () => {
    get.mockImplementation((key: string) =>
      key === 'LOCAL_EMBEDDINGS_URL' ? 'http://127.0.0.1:8001' : undefined,
    );

    await expect(
      service.createPrimaryEmbedding('near university', 'search_query'),
    ).rejects.toThrow('COHERE_EMBEDDING_NOT_CONFIGURED');
  });

  it('does not use the local model when local embeddings are disabled', async () => {
    get.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        COHERE_API_KEY: 'test-key',
        LOCAL_EMBEDDINGS_ENABLED: 'false',
      };
      return values[key];
    });
    jest
      .spyOn(axios, 'post')
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 429 } });

    await expect(
      service.createPrimaryEmbedding('near university', 'search_query'),
    ).rejects.toMatchObject({ response: { status: 429 } });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
