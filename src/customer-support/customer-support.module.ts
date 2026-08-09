import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { RealtimeModule } from 'src/realtime/realtime.module';
import { MailModule } from 'src/mail/mail.module';
import { CustomerSupportController } from './customer-support.controller';
import { CustomerSupportService } from './customer-support.service';

@Module({
  imports: [PrismaModule, RealtimeModule, MailModule],
  controllers: [CustomerSupportController],
  providers: [CustomerSupportService],
  exports: [CustomerSupportService],
})
export class CustomerSupportModule {}
