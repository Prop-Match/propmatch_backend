import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { VerifiedGuard } from './guards/verified.guard';

/**
 * Shared utilities used across multiple feature modules.
 *
 * Export guards/pipes/interceptors here so feature modules can
 * import CommonModule and inject them.
 */
@Module({
  imports: [PrismaModule],
  providers: [VerifiedGuard],
  exports: [VerifiedGuard],
})
export class CommonModule {}
