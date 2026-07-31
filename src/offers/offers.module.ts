import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { SemanticMatchingConfig } from '../config/semantic-matching.config';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  imports: [CommonModule],
  controllers: [OffersController],
  providers: [OffersService, SemanticMatchingConfig],
})
export class OffersModule {}
