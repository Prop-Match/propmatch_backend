import { Module } from '@nestjs/common';
import { PartnerLeadsController } from './partner-leads.controller';
import { PartnerLeadsService } from './partner-leads.service';

@Module({
  controllers: [PartnerLeadsController],
  providers: [PartnerLeadsService],
})
export class PartnerLeadsModule {}
