import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import {
  ContractUserReviewsController,
  UserReviewSummaryController,
} from './user-reviews.controller';
import { UserReviewsService } from './user-reviews.service';

@Module({
  imports: [CommonModule],
  controllers: [
    ReviewsController,
    ContractUserReviewsController,
    UserReviewSummaryController,
  ],
  providers: [ReviewsService, UserReviewsService],
})
export class ReviewsModule {}
