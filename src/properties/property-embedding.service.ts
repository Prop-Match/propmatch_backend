import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class PropertyEmbeddingService {
  constructor(private readonly configService: ConfigService) {}

  async createEmbedding(document: string): Promise<number[]> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('PROPERTY_EMBEDDING_NOT_CONFIGURED');
    }

    const response = await axios.post<{ data: Array<{ embedding: number[] }> }>(
      'https://api.openai.com/v1/embeddings',
      {
        input: document,
        model:
          this.configService.get<string>('OPENAI_EMBEDDING_MODEL') ??
          'text-embedding-3-small',
      },
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    const embedding = response.data.data[0]?.embedding;
    if (!embedding) {
      throw new Error('PROPERTY_EMBEDDING_EMPTY_RESPONSE');
    }
    return embedding;
  }
}
