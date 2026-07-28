import { Module } from '@nestjs/common';
import { PrivateStorageModule } from '../storage/private-storage.module';
import {
  LeaseContractByIdController,
  LeaseContractsController,
} from './lease-contracts.controller';
import { LeaseContractsService } from './lease-contracts.service';
import { PdfRendererService } from './pdf-renderer.service';

@Module({
  imports: [PrivateStorageModule],
  controllers: [LeaseContractsController, LeaseContractByIdController],
  providers: [LeaseContractsService, PdfRendererService],
})
export class LeaseContractsModule {}
