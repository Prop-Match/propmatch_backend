import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { RealtimeModule } from 'src/realtime/realtime.module';
import { CustomerSupportController } from './customer-support.controller';
import { CustomerSupportService } from './customer-support.service';

@Module({
  imports: [PrismaModule, RealtimeModule],
  controllers: [CustomerSupportController],
  providers: [CustomerSupportService],
  exports: [CustomerSupportService],
})
export class CustomerSupportModule {}
