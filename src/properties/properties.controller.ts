import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Res,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { PropertiesService } from './properties.service';
import { FormOptimizerService } from './services/FormOptimizer.service';
import { QuotaService } from '../quota/quota.service';
import { CreatePropertyMultipartDto } from './dto/create-property-multipart.dto';
import { PropertySearchQueryDto } from './dto/property-search-query.dto';
import { SemanticPropertySearchDto } from './dto/semantic-property-search.dto';
import { SemanticPropertySearchResponse } from './dto/semantic-property-search-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  MAX_PROPERTY_IMAGES,
  MAX_PROPERTY_IMAGE_SIZE,
  PROPERTY_IMAGE_MIME_TYPES,
  PropertyImageStorageService,
} from './property-image-storage.service';

@Controller()
export class PropertiesController {
  constructor(
    private readonly propertiesService: PropertiesService,
    private readonly formOptimizerService: FormOptimizerService,
    private readonly quotaService: QuotaService,
    private readonly propertyImageStorage: PropertyImageStorageService,
  ) {}

  /**
   * POST /api/landlord/properties
   *
   * Creates a new property listing for the authenticated landlord.
   * Requires JWT auth + LANDLORD role + APPROVED identity verification.
   * Gates: free listing quota must be > 0.
   */
  @Post('landlord/properties')
  @UseGuards(JwtAuthGuard, RolesGuard, VerifiedGuard)
  @Roles('LANDLORD')
  @UseInterceptors(
    FilesInterceptor('images', MAX_PROPERTY_IMAGES, {
      limits: {
        files: MAX_PROPERTY_IMAGES,
        fileSize: MAX_PROPERTY_IMAGE_SIZE,
      },
      fileFilter: (_request, file, callback) => {
        if (!PROPERTY_IMAGE_MIME_TYPES.has(file.mimetype)) {
          callback(new BadRequestException('نوع الصورة غير مدعوم.'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async create(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreatePropertyMultipartDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const imageUrls = await this.propertyImageStorage.uploadMany(files);
    try {
      return await this.propertiesService.create(req.user.userId, {
        ...dto,
        images: imageUrls,
      });
    } catch (error) {
      await this.propertyImageStorage.deleteMany(imageUrls);
      throw error;
    }
  }

  /**
   * GET /api/properties — hybrid search / browse (PRO-11).
   *
   * Public on purpose: anonymous tenants browse without logging in (the
   * frontend gates only their own surfaces, not browse). Returns summaries —
   * never owner PII.
   */
  @Get('properties')
  async getAllProperties(@Query() query: PropertySearchQueryDto) {
    return this.propertiesService.getAll(query);
  }

  /** Public semantic browse endpoint; PostgreSQL approval status remains authoritative. */
  @Get('properties/search/semantic')
  async semanticSearch(
    @Query() query: SemanticPropertySearchDto,
  ): Promise<SemanticPropertySearchResponse> {
    return this.propertiesService.semanticSearch(query);
  }

  @Get('landlord/properties')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('LANDLORD')
  async getMyProperties(@Request() req: { user: { userId: string } }) {
    return this.propertiesService.getMyProperties(req.user.userId);
  }

  @Get('properties/:id')
  @UseGuards(JwtAuthGuard)
  async getPropertyById(
    @Param('id') id: string,
    @Request() req: { user: { userId: string; role: string } },
  ) {
    return this.propertiesService.getPropertyById(id, req.user);
  }

  @Post('landlord/properties/draft/optimize-description/stream')
  @UseGuards(JwtAuthGuard, RolesGuard, VerifiedGuard)
  @Roles('LANDLORD')
  async optimizeDescriptionStream(
    @Request() req: { user: { userId: string } },
    @Body() body: any,
    @Res() res: Response,
  ) {
    // PRO-18: spend one optimizer use BEFORE opening the stream. If the quota
    // is gone this throws QUOTA_EXHAUSTED → Nest returns a JSON 403 (the stream
    // has not started), which the frontend turns into the AI_ADDON
    // paywall. Once SSE is committed a 403 would be impossible.
    await this.quotaService.consumeOptimizer(req.user.userId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const stream$ = this.formOptimizerService.optimizeDescriptionStream(body);
      stream$.subscribe({
        next: (msg) => {
          res.write(`data: ${JSON.stringify(msg.data)}\n\n`);
        },
        complete: () => {
          res.end();
        },
        error: () => {
          if (!res.headersSent) {
            res.status(502).json({
              message: 'Description optimization is temporarily unavailable.',
            });
          } else {
            res.end();
          }
        },
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unexpected optimizer error';
      res.status(500).json({ message });
      res.end();
    }
  }
}
