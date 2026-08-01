import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChromaPropertyService } from './chroma-property.service';
import { PropertyEmbeddingService } from './property-embedding.service';
import { PropertySearchDocumentBuilder } from './property-search-document.builder';

import { I18nContext } from 'nestjs-i18n';

@Injectable()
export class PropertyApprovalIndexingService {
  private readonly logger = new Logger(PropertyApprovalIndexingService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly documentBuilder: PropertySearchDocumentBuilder,
    private readonly embeddingService: PropertyEmbeddingService,
    private readonly chromaService: ChromaPropertyService,
  ) {}

  async indexApprovedProperty(propertyId: string): Promise<void> {
    const property = await this.prismaService.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        title: true,
        description: true,
        governorate: { select: { nameAr: true, nameEn: true } },
        city: { select: { nameAr: true, nameEn: true } },
        district: true,
        propertyType: true,
        propertyAroundServices: true,
        rentAmount: true,
        areaM2: true,
        bedrooms: true,
        bathrooms: true,
        isFurnished: true,
        hasElevator: true,
        hasParking: true,
        status: true,
      },
    });

    if (!property || property.status !== 'APPROVED') return;

    const lang = I18nContext.current()?.lang ?? 'ar';
    const isAr = lang.startsWith('ar');

    const { document, metadata } = this.documentBuilder.build({
      ...property,
      governorate: isAr
        ? property.governorate.nameAr
        : property.governorate.nameEn,
      city: isAr ? property.city.nameAr : property.city.nameEn,
    });
    const vectorId = `property:${property.id}`;
    // Keep independent indexes because Cohere and the local model have
    // different dimensions and cannot share a Chroma collection.
    const [cohereResult, localResult] = await Promise.allSettled([
      this.embeddingService.createCohereEmbedding(document, 'search_document'),
      this.embeddingService.isLocalEmbeddingEnabled()
        ? this.embeddingService.createLocalEmbedding(document)
        : Promise.reject(new Error('LOCAL_EMBEDDING_DISABLED')),
    ]);

    const chromaTasks: Promise<unknown>[] = [];
    if (cohereResult.status === 'fulfilled') {
      chromaTasks.push(
        this.chromaService.upsert(
          'cohere',
          vectorId,
          document,
          cohereResult.value,
          metadata,
        ),
      );
    }
    if (localResult.status === 'fulfilled') {
      chromaTasks.push(
        this.chromaService.upsert(
          'local',
          vectorId,
          document,
          localResult.value,
          metadata,
        ),
      );
    }

    // Same "primary" precedence as PropertyEmbeddingService.createPrimaryEmbedding
    // (Cohere first, local fallback) — MatchingWorker's cosine-similarity path
    // reads this column directly via plain SQL, never Chroma, so it must be
    // populated here or every property silently scores semanticSimilarity: null.
    const primaryEmbedding =
      cohereResult.status === 'fulfilled'
        ? cohereResult.value
        : localResult.status === 'fulfilled'
          ? localResult.value
          : null;
    if (primaryEmbedding) {
      chromaTasks.push(
        this.prismaService.property.update({
          where: { id: property.id },
          data: { embedding: primaryEmbedding },
        }),
      );
    }

    if (chromaTasks.length === 0) {
      // Both providers failed — surface it the same way a single-provider
      // failure used to (caller logs via logIndexingFailure), rather than
      // silently leaving the property unindexed with no signal.
      throw cohereResult.status === 'rejected'
        ? cohereResult.reason
        : localResult.status === 'rejected'
          ? localResult.reason
          : new Error('EMBEDDING_INDEXING_FAILED');
    }

    await Promise.all(chromaTasks);
  }

  logIndexingFailure(propertyId: string, error: unknown): void {
    const category =
      error instanceof Error && error.message.includes('NOT_CONFIGURED')
        ? 'configuration'
        : 'provider';
    this.logger.error(
      `property indexing failed: propertyId=${propertyId} category=${category}`,
    );
  }
}
