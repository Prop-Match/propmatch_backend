import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
<<<<<<< HEAD
=======
  ParseUUIDPipe,
>>>>>>> e9c3895ac73281ab8c8333a95cae86f9c3c79b70
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
<<<<<<< HEAD
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
=======
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FavoritesService } from './favorites.service';
import { CreateFavoriteDto } from './dto/create-favorite.dto';

@Controller('tenant/favorites')
@UseGuards(JwtAuthGuard, RolesGuard)
>>>>>>> e9c3895ac73281ab8c8333a95cae86f9c3c79b70
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
<<<<<<< HEAD
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
=======
  @Roles('TENANT')
  async getFavorites(@Request() req: { user: { userId: string } }) {
    return this.favoritesService.getFavorites(req.user.userId);
  }

  @Post()
  @Roles('TENANT')
  async addFavorite(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreateFavoriteDto,
  ) {
    return this.favoritesService.addFavorite(req.user.userId, dto);
  }

  @Delete(':propertyId')
  @Roles('TENANT')
  async removeFavorite(
    @Request() req: { user: { userId: string } },
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.favoritesService.removeFavorite(req.user.userId, propertyId);
>>>>>>> e9c3895ac73281ab8c8333a95cae86f9c3c79b70
  }
}
