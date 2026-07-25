import { Global, Module } from '@nestjs/common';
import { QuotaController } from './quota.controller';
import { QuotaService } from './quota.service';

/**
 * PRO-18 freemium enforcement. `@Global` + exporting QuotaService so any module
 * (e.g. the optimizer endpoint in PropertiesController) can consume quota
 * without re-importing. PrismaService is already global.
 */
@Global()
@Module({
  controllers: [QuotaController],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
