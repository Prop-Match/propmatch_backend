import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseRedisConnection } from '../matching/redis-connection.util';
import { MAIL_QUEUE } from './mail.constants';
import { MailService } from './mail.service';
import { MailWorker } from './mail.worker';

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
) {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: MAIL_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const attempts = positiveInteger(
          config.get<string>('MAIL_JOB_ATTEMPTS'),
          5,
          'MAIL_JOB_ATTEMPTS',
        );
        const backoffDelay = positiveInteger(
          config.get<string>('MAIL_JOB_BACKOFF_MS'),
          5000,
          'MAIL_JOB_BACKOFF_MS',
        );
        return {
          connection: parseRedisConnection(config.get<string>('REDIS_URL')),
          defaultJobOptions: {
            attempts,
            backoff: {
              type: 'exponential',
              delay: backoffDelay,
            },
            removeOnComplete: { age: 86400, count: 1000 },
            removeOnFail: { age: 604800 },
          },
        };
      },
    }),
  ],
  providers: [MailService, MailWorker],
  exports: [MailService],
})
export class MailModule {}
