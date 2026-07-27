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
import { RolesGuard } from '../auth/guards/roles.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

/** SRS 3.7 — public property reviews. */
@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post('reviews')
  @UseGuards(JwtAuthGuard, RolesGuard, VerifiedGuard)
  @Roles('TENANT')
  create(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.create(req.user.userId, dto);
  }

  /** Public on purpose: anonymous visitors read reviews same as browsing properties. */
  @Get('properties/:id/reviews')
  findForProperty(@Param('id') id: string) {
    return this.reviewsService.findForProperty(id);
  }
}
