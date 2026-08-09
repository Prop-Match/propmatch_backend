import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { RealtimeModule } from 'src/realtime/realtime.module';
import { CustomerSupportController } from './customer-support.controller';
import { CustomerSupportService } from './customer-support.service';
import { SupportAgentInternalController } from './support-agent-internal.controller';
import { SupportAgentInternalGuard } from './support-agent-internal.guard';

@Module({
  imports: [PrismaModule, RealtimeModule],
  controllers: [CustomerSupportController, SupportAgentInternalController],
  providers: [CustomerSupportService, SupportAgentInternalGuard],
  exports: [CustomerSupportService],
})
export class CustomerSupportModule {}
