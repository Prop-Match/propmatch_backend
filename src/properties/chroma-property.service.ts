import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { EmbeddingProvider } from './property-embedding.service';

type LocalChromaQueryResponse = {
  ids: string[][];
  distances: number[][];
};

export type PropertyVectorQuery = {
  provider: EmbeddingProvider;
  embedding: number[];
  limit: number;
};
export type PropertyVectorMatch = {
  vectorId: string;
  propertyId: string;
  distance?: number;
};

@Injectable()
export class ChromaPropertyService {
  constructor(private readonly configService: ConfigService) {}

  private get serviceUrl(): string {
    return (
      this.configService.get<string>('LOCAL_EMBEDDINGS_URL') ??
      'http://127.0.0.1:8001'
    ).replace(/\/$/, '');
  }

  private collectionFor(provider: EmbeddingProvider): string {
    if (provider === 'cohere') {
      return (
        this.configService.get<string>('CHROMA_COHERE_COLLECTION') ??
        'propmatch_properties_cohere_v1'
      );
    }
    return (
      this.configService.get<string>('CHROMA_LOCAL_COLLECTION') ??
      this.configService.get<string>('CHROMA_COLLECTION') ??
      'propmatch_properties_local_v1'
    );
  }

  async upsert(
    provider: EmbeddingProvider,
    vectorId: string,
    document: string,
    embedding: number[],
    metadata: Record<string, string | number | boolean>,
  ): Promise<void> {
    await axios.post(
      `${this.serviceUrl}/upsert`,
      {
        collection: this.collectionFor(provider),
        id: vectorId,
        document,
        embedding,
        metadata,
      },
      { timeout: 30_000 },
    );
  }

  async query(query: PropertyVectorQuery): Promise<PropertyVectorMatch[]> {
    const response = await axios.post<LocalChromaQueryResponse>(
      `${this.serviceUrl}/query`,
      {
        collection: this.collectionFor(query.provider),
        embedding: query.embedding,
        n_results: query.limit,
      },
      { timeout: 30_000 },
    );
    return (response.data.ids[0] ?? []).flatMap((vectorId, index) => {
      if (!vectorId.startsWith('property:')) return [];
      const propertyId = vectorId.slice('property:'.length);
      if (!propertyId) return [];
      return [{ vectorId, propertyId, distance: response.data.distances[0]?.[index] }];
    });
  }

  /** Removes an archived property's vector from one provider collection. */
  async remove(provider: EmbeddingProvider, vectorId: string): Promise<void> {
    await axios.post(
      `${this.serviceUrl}/delete`,
      { collection: this.collectionFor(provider), id: vectorId },
      { timeout: 30_000 },
    );
  }
}
