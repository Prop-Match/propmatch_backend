import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { RealtimeModule } from 'src/realtime/realtime.module';
import { MailModule } from 'src/mail/mail.module';
import { CustomerSupportController } from './customer-support.controller';
import { CustomerSupportService } from './customer-support.service';
import { SupportAgentInternalController } from './support-agent-internal.controller';
import { SupportAgentInternalGuard } from './support-agent-internal.guard';

@Module({
  imports: [PrismaModule, RealtimeModule, MailModule],
  controllers: [CustomerSupportController, SupportAgentInternalController],
  providers: [CustomerSupportService, SupportAgentInternalGuard],
  exports: [CustomerSupportService],
})
export class CustomerSupportModule {}
