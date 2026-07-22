import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

type LocalEmbeddingResponse = {
  embedding: number[];
  dimension: number;
  model: string;
};

@Injectable()
export class PropertyEmbeddingService {
  private readonly logger = new Logger(PropertyEmbeddingService.name);

  constructor(private readonly configService: ConfigService) {}

  async createEmbedding(text: string): Promise<number[]> {
    if (this.configService.get<string>('EMBEDDING_PROVIDER') !== 'local') {
      throw new Error('LOCAL_EMBEDDING_PROVIDER_NOT_CONFIGURED');
    }

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
}
