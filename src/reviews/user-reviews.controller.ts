import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { CreateUserReviewDto } from './dto/create-user-review.dto';
import { UserReviewsService } from './user-reviews.service';

@Controller('contracts/:contractId/user-review')
@UseGuards(JwtAuthGuard, RolesGuard, VerifiedGuard)
@Roles('TENANT', 'LANDLORD')
export class ContractUserReviewsController {
  constructor(private readonly userReviews: UserReviewsService) {}

  @Get()
  status(
    @Request() req: { user: { userId: string } },
    @Param('contractId') contractId: string,
  ) {
    return this.userReviews.statusForContract(req.user.userId, contractId);
  }

  @Post()
  create(
    @Request() req: { user: { userId: string } },
    @Param('contractId') contractId: string,
    @Body() dto: CreateUserReviewDto,
  ) {
    return this.userReviews.create(req.user.userId, contractId, dto);
  }
}

@Controller('users/:userId/reviews')
@UseGuards(JwtAuthGuard)
export class UserReviewSummaryController {
  constructor(private readonly userReviews: UserReviewsService) {}

  @Get('summary')
  summary(@Param('userId') userId: string) {
    return this.userReviews.summaryForUser(userId);
  }
}
