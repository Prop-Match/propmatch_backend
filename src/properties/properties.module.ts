import { Module } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';
import { CommonModule } from '../common/common.module';
import { FormOptimizerService } from './services/FormOptimizer.service';

@Module({
  imports: [CommonModule],
  controllers: [PropertiesController],
  providers: [PropertiesService, FormOptimizerService],
})
export class PropertiesModule {}
