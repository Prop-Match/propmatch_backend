import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class ChromaPropertyService {
  constructor(private readonly configService: ConfigService) {}

  async upsert(
    vectorId: string,
    document: string,
    embedding: number[],
    metadata: Record<string, string | number | boolean>,
  ): Promise<void> {
    const chromaUrl = this.configService.get<string>('CHROMA_URL');
    if (!chromaUrl) {
      throw new Error('CHROMA_NOT_CONFIGURED');
    }
    const collection =
      this.configService.get<string>('CHROMA_PROPERTY_COLLECTION') ??
      'properties';

    await axios.post(
      `${chromaUrl.replace(/\/$/, '')}/api/v1/collections/${collection}/upsert`,
      {
        ids: [vectorId],
        documents: [document],
        embeddings: [embedding],
        metadatas: [metadata],
      },
    );
  }
}
