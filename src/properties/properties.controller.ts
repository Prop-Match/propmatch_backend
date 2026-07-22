import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { PropertiesService } from './properties.service';
import { FormOptimizerService } from './services/FormOptimizer.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { PropertySearchQueryDto } from './dto/property-search-query.dto';
import { SemanticPropertySearchDto } from './dto/semantic-property-search.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller()
export class PropertiesController {
  constructor(
    private readonly propertiesService: PropertiesService,
    private readonly formOptimizerService: FormOptimizerService,
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
  async create(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreatePropertyDto,
  ) {
    return this.propertiesService.create(req.user.userId, dto);
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
  async semanticSearch(@Query() query: SemanticPropertySearchDto) {
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
    @Body() body: any,
    @Res() res,
  ) {
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
    } catch (error: any) {
      console.log(error);
      res.status(500).json({ message: error.message });
      res.end();
    }
  }
}
