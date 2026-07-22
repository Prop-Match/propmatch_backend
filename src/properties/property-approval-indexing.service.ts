import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChromaPropertyService } from './chroma-property.service';
import { PropertyEmbeddingService } from './property-embedding.service';
import { PropertySearchDocumentBuilder } from './property-search-document.builder';

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
        governorate: true,
        city: true,
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

    const { document, metadata } = this.documentBuilder.build(property);
    const embedding = await this.embeddingService.createEmbedding(document);
    await this.chromaService.upsert(
      `property:${property.id}`,
      document,
      embedding,
      metadata,
    );
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
