import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Index } from '@upstash/vector';
import { EmbeddingProvider } from './property-embedding.service';

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

/**
 * Drop-in replacement for the old ChromaDB-backed service.
 *
 * Uses **Upstash Vector** as a persistent, serverless vector store.
 * Chroma "collections" are mapped to Upstash Vector **namespaces**
 * (one per embedding provider: `cohere`, `local`).
 *
 * The Postgres `Property.embedding` column remains the single source of
 * truth for the MatchingWorker's cosine-similarity SQL path — this service
 * is the fast-retrieval / semantic-search layer on top.
 */
@Injectable()
export class ChromaPropertyService {
  private readonly logger = new Logger(ChromaPropertyService.name);
  private readonly index: Index;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.getOrThrow<string>(
      'UPSTASH_VECTOR_REST_URL',
    );
    const token = this.configService.getOrThrow<string>(
      'UPSTASH_VECTOR_REST_TOKEN',
    );
    this.index = new Index({ url, token });
  }

  /** Map embedding-provider name → Upstash Vector namespace. */
  private namespaceFor(provider: EmbeddingProvider): string {
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
    const ns = this.index.namespace(this.namespaceFor(provider));
    await ns.upsert({
      id: vectorId,
      vector: embedding,
      metadata: { ...metadata, _document: document },
    });
  }

  async query(query: PropertyVectorQuery): Promise<PropertyVectorMatch[]> {
    const ns = this.index.namespace(this.namespaceFor(query.provider));
    const results = await ns.query({
      vector: query.embedding,
      topK: query.limit,
      includeMetadata: false,
    });

    return results.flatMap((match) => {
      const vectorId = String(match.id);
      if (!vectorId.startsWith('property:')) return [];
      const propertyId = vectorId.slice('property:'.length);
      if (!propertyId) return [];
      // Upstash returns similarity scores (0–1, higher = more similar).
      // Chroma returned distances (lower = more similar).
      // Convert: distance ≈ 1 - score for cosine similarity.
      const distance = match.score != null ? 1 - match.score : undefined;
      return [{ vectorId, propertyId, distance }];
    });
  }

  /** Removes an archived property's vector from one provider namespace. */
  async remove(provider: EmbeddingProvider, vectorId: string): Promise<void> {
    const ns = this.index.namespace(this.namespaceFor(provider));
    await ns.delete(vectorId);
  }
}
