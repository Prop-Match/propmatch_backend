import { Module } from '@nestjs/common';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';

/**
 * PRO-13 matchmaker. Exports MatchingService so the offers module (and anyone
 * else) can reuse the scoring without duplicating the algorithm.
 */
@Module({
  controllers: [MatchingController],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
