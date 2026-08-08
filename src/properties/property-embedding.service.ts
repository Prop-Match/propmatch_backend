import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export type EmbeddingProvider = 'cohere' | 'local';
export type EmbeddingInputType = 'search_document' | 'search_query';

type LocalEmbeddingResponse = {
  embedding: number[];
  dimension: number;
  model: string;
};

type CohereEmbeddingResponse = {
  embeddings?: { float?: number[][] };
};

export type ProviderEmbedding = {
  provider: EmbeddingProvider;
  embedding: number[];
};

@Injectable()
export class PropertyEmbeddingService {
  private readonly logger = new Logger(PropertyEmbeddingService.name);

  constructor(private readonly configService: ConfigService) {}

  async createPrimaryEmbedding(
    text: string,
    inputType: EmbeddingInputType,
  ): Promise<ProviderEmbedding> {
    // Honor an explicit local provider: go straight to the local embeddings
    // service instead of requiring Cohere and only falling back on a transient
    // Cohere failure (a missing COHERE_API_KEY is non-transient, so without this
    // EMBEDDING_PROVIDER=local would still fail with COHERE_EMBEDDING_NOT_CONFIGURED).
    if (
      this.configService.get<string>('EMBEDDING_PROVIDER')?.toLowerCase() ===
        'local' &&
      this.isLocalEmbeddingEnabled()
    ) {
      return { provider: 'local', embedding: await this.createLocalEmbedding(text) };
    }
    try {
      return {
        provider: 'cohere',
        embedding: await this.createCohereEmbedding(text, inputType),
      };
    } catch (error) {
      if (!this.isTransientCohereFailure(error)) throw error;
      if (!this.isLocalEmbeddingEnabled()) throw error;
      this.logger.warn(
        'Cohere embeddings are temporarily unavailable; using local fallback',
      );
      return {
        provider: 'local',
        embedding: await this.createLocalEmbedding(text),
      };
    }
  }

  async createCohereEmbedding(
    text: string,
    inputType: EmbeddingInputType,
  ): Promise<number[]> {
    const apiKey = this.configService.get<string>('COHERE_API_KEY');
    if (!apiKey) throw new Error('COHERE_EMBEDDING_NOT_CONFIGURED');
    const model =
      this.configService.get<string>('COHERE_EMBEDDING_MODEL') ?? 'embed-v4.0';
    const configuredDimension = Number.parseInt(
      this.configService.get<string>('COHERE_EMBEDDING_DIMENSION') ?? '1024',
      10,
    );
    const outputDimension = [256, 512, 1024, 1536].includes(configuredDimension)
      ? configuredDimension
      : 1024;
    const response = await axios.post<CohereEmbeddingResponse>(
      'https://api.cohere.com/v2/embed',
      {
        model,
        texts: [text],
        input_type: inputType,
        embedding_types: ['float'],
        output_dimension: outputDimension,
      },
      {
        timeout: 30_000,
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    const embedding = response.data.embeddings?.float?.[0];
    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error('COHERE_EMBEDDING_INVALID_RESPONSE');
    }
    return embedding;
  }

  async createLocalEmbedding(text: string): Promise<number[]> {
    const serviceUrl =
      this.configService.get<string>('LOCAL_EMBEDDINGS_URL') ??
      'http://127.0.0.1:8001';
    try {
      const response = await axios.post<LocalEmbeddingResponse>(
        `${serviceUrl.replace(/\/$/, '')}/embed`,
        { text },
        { timeout: 30_000 },
      );
      const embedding = response.data.embedding;
      if (
        !Array.isArray(embedding) ||
        embedding.length === 0 ||
        embedding.some((value) => !Number.isFinite(value))
      ) {
        throw new Error('LOCAL_EMBEDDING_INVALID_RESPONSE');
      }
      this.logger.debug(
        `Generated ${response.data.dimension}-dimension local embedding with ${response.data.model}`,
      );
      return embedding;
    } catch (error) {
      this.logger.error('Local embedding service request failed');
      throw new Error('LOCAL_EMBEDDING_SERVICE_UNAVAILABLE', { cause: error });
    }
  }

  isLocalEmbeddingEnabled(): boolean {
    return (
      this.configService
        .get<string>('LOCAL_EMBEDDINGS_ENABLED')
        ?.toLowerCase() !== 'false'
    );
  }

  private isTransientCohereFailure(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false;
    const status = error.response?.status;
    return (
      status === undefined || status === 408 || status === 429 || status >= 500
    );
  }
}
