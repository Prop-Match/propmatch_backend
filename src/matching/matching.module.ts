import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PropertiesModule } from '../properties/properties.module';
import { SemanticMatchingConfig } from '../config/semantic-matching.config';
import { MATCHING_QUEUE } from './matching.constants';
import { MatchingWorker } from './matching.worker';
import { parseRedisConnection } from './redis-connection.util';

@Module({
  imports: [
    PropertiesModule,
    BullModule.registerQueueAsync({
      name: MATCHING_QUEUE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: parseRedisConnection(
          configService.get<string>('REDIS_URL'),
        ),
      }),
    }),
  ],
  providers: [MatchingWorker, SemanticMatchingConfig],
  // Other modules (e.g. TenantRequestsModule) will import MatchingModule to
  // enqueue jobs via @InjectQueue(MATCHING_QUEUE) once the producer is wired.
  exports: [BullModule],
})
export class MatchingModule {}
