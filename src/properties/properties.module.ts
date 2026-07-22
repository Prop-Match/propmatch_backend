import { Module } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';
import { CommonModule } from '../common/common.module';
import { FormOptimizerService } from './services/FormOptimizer.service';
import { PropertySearchDocumentBuilder } from './property-search-document.builder';
import { PropertyEmbeddingService } from './property-embedding.service';
import { ChromaPropertyService } from './chroma-property.service';
import { PropertyApprovalIndexingService } from './property-approval-indexing.service';

@Module({
  imports: [CommonModule],
  controllers: [PropertiesController],
  providers: [
    PropertiesService,
    FormOptimizerService,
    PropertySearchDocumentBuilder,
    PropertyEmbeddingService,
    ChromaPropertyService,
    PropertyApprovalIndexingService,
  ],
  exports: [PropertyApprovalIndexingService],
})
export class PropertiesModule {}
