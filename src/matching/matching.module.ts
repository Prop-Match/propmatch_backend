import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PropertiesModule } from '../properties/properties.module';
import { SemanticMatchingConfig } from '../config/semantic-matching.config';
import { MatchingQueueConfig } from '../config/matching-queue.config';
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
        // Pre-production hardening (docs/smart-matching-engine-architecture.md
        // §8): retry with exponential backoff instead of failing permanently
        // on the first transient error, and bound how long completed/failed
        // jobs linger in Redis. Every value is env-overridable — see
        // MatchingQueueConfig — not hardcoded here.
        defaultJobOptions: new MatchingQueueConfig(
          configService,
        ).toDefaultJobOptions(),
      }),
    }),
  ],
  providers: [MatchingWorker, SemanticMatchingConfig],
  // Other modules (e.g. TenantRequestsModule) will import MatchingModule to
  // enqueue jobs via @InjectQueue(MATCHING_QUEUE) once the producer is wired.
  exports: [BullModule],
})
export class MatchingModule {}
