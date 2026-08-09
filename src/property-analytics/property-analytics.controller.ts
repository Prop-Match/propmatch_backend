import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PropertyAnalyticsQueryDto } from './dto/property-analytics-query.dto';
import { TrackPropertyViewDto } from './dto/track-property-view.dto';
import { PropertyAnalyticsService } from './property-analytics.service';

@Controller()
export class PropertyAnalyticsController {
  constructor(private readonly analytics: PropertyAnalyticsService) {}

  @Post('properties/:id/views')
  @UseGuards(OptionalJwtAuthGuard)
  trackView(
    @Param('id') propertyId: string,
    @Body() dto: TrackPropertyViewDto,
    @Request() req: { user?: { userId: string; role: string } },
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.analytics.trackView(
      propertyId,
      req.user,
      dto.visitorId,
      userAgent,
    );
  }

  @Get('landlord/properties/:id/analytics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('LANDLORD')
  getAnalytics(
    @Param('id') propertyId: string,
    @Query() query: PropertyAnalyticsQueryDto,
    @Request() req: { user: { userId: string } },
  ) {
    return this.analytics.getPropertyAnalytics(
      req.user.userId,
      propertyId,
      query.period,
    );
  }
}
