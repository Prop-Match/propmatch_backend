import { Module } from '@nestjs/common';
import { AdminTicketsController } from './admin-tickets.controller';
import { HandoffController } from './handoff.controller';
import { SupportService } from './support.service';

@Module({
  controllers: [AdminTicketsController, HandoffController],
  providers: [SupportService],
})
export class SupportModule {}
