import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FavoritesService } from './favorites.service';
import { CreateFavoriteDto } from './dto/create-favorite.dto';

/**
 * Tenant favorites (JWT + TENANT role), under /api:
 *   GET    /api/tenant/favorites             -> { items }
 *   POST   /api/tenant/favorites             -> { favorited: true }
 *   DELETE /api/tenant/favorites/:propertyId -> { favorited: false }
 */
@Controller('tenant/favorites')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TENANT')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  getFavorites(@Request() req: { user: { userId: string } }) {
    return this.favoritesService.getFavorites(req.user.userId);
  }

  @Post()
  addFavorite(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreateFavoriteDto,
  ) {
    return this.favoritesService.addFavorite(req.user.userId, dto);
  }

  @Delete(':propertyId')
  removeFavorite(
    @Request() req: { user: { userId: string } },
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.favoritesService.removeFavorite(req.user.userId, propertyId);
  }
}
