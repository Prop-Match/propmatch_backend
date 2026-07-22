import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

type LocalChromaQueryResponse = {
  ids: string[][];
  distances: number[][];
};

export type PropertyVectorQuery = { embedding: number[]; limit: number };
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

  async upsert(
    vectorId: string,
    document: string,
    embedding: number[],
    metadata: Record<string, string | number | boolean>,
  ): Promise<void> {
    await axios.post(
      `${this.serviceUrl}/upsert`,
      { id: vectorId, document, embedding, metadata },
      { timeout: 30_000 },
    );
  }

  async query(query: PropertyVectorQuery): Promise<PropertyVectorMatch[]> {
    const response = await axios.post<LocalChromaQueryResponse>(
      `${this.serviceUrl}/query`,
      { embedding: query.embedding, n_results: query.limit },
      { timeout: 30_000 },
    );
    return (response.data.ids[0] ?? []).flatMap((vectorId, index) => {
      if (!vectorId.startsWith('property:')) return [];
      const propertyId = vectorId.slice('property:'.length);
      if (!propertyId) return [];
      return [{ vectorId, propertyId, distance: response.data.distances[0]?.[index] }];
    });
  }
}
