import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymobService } from './providers/paymob.service';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymobService],
  imports: [HttpModule, PrismaModule],
})
export class PaymentsModule {}
