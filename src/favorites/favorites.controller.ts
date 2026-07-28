import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * Routes (tenant-only, under /api):
 *   GET    /api/tenant/favorites            -> { items }
 *   POST   /api/tenant/favorites            -> { favorited: true }
 *   DELETE /api/tenant/favorites/:propertyId -> { favorited: false }
 */
@Controller('tenant/favorites')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TENANT')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  list(@Request() req: { user: { userId: string } }) {
    return this.favoritesService.list(req.user.userId);
  }

  @Post()
  add(
    @Request() req: { user: { userId: string } },
    @Body() body: { propertyId: string },
  ) {
    return this.favoritesService.add(req.user.userId, body.propertyId);
  }

  @Delete(':propertyId')
  remove(
    @Request() req: { user: { userId: string } },
    @Param('propertyId') propertyId: string,
  ) {
    return this.favoritesService.remove(req.user.userId, propertyId);
  }
}
