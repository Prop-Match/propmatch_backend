import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import type { PrivateObjectStorage } from './private-object-storage.interface';
import { PRIVATE_OBJECT_STORAGE } from './private-object-storage.token';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('api/storage/private')
export class PrivateStorageController {
  constructor(
    @Inject(PRIVATE_OBJECT_STORAGE)
    private readonly privateObjectStorage: PrivateObjectStorage,
  ) {}
  @Get(':token')
  async read(@Param('token') token: string, @Res() response: Response) {
    try {
      const object = await this.privateObjectStorage.readTemporaryObject(token);
      response.setHeader('Content-Type', object.contentType);
      response.setHeader('Content-Disposition', 'inline');
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.send(object.data);
    } catch {
      throw new NotFoundException('PRIVATE_DOCUMENT_NOT_FOUND');
    }
  }
}
