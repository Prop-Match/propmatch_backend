import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { RejectDraftDto } from './dto/reject-draft.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import { ConfirmContractReviewDto, RequestContractChangesDto } from './dto/contract-review.dto';
import { LeaseContractsService } from './lease-contracts.service';

/**
 * Handshake flow: landlord drafts (POST .../draft, repeatable while
 * DRAFTING) → landlord sends for review (POST .../send-for-review, locks
 * it) → tenant approves (POST .../approve, the only path that actually
 * generates a PDF) or rejects (POST .../reject, unlocks it back to the
 * landlord with an optional note).
 */
@Controller('matches/:matchConnectionId/contract')
@UseGuards(JwtAuthGuard)
export class LeaseContractsController {
  constructor(
    private readonly leaseContractsService: LeaseContractsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async getForMatch(
    @Request() req: { user: { userId: string } },
    @Param('matchConnectionId') matchConnectionId: string,
  ) {
    const contract = await this.leaseContractsService.getForMatch(
      req.user.userId,
      matchConnectionId,
    );
    return this.withAbsolutePdfUrl(contract);
  }

  @Get('prefill')
  async getPrefill(
    @Request() req: { user: { userId: string } },
    @Param('matchConnectionId') matchConnectionId: string,
  ) {
    return this.leaseContractsService.getPrefill(
      req.user.userId,
      matchConnectionId,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('draft')
  @UseGuards(VerifiedGuard)
  async saveDraft(
    @Request() req: { user: { userId: string } },
    @Param('matchConnectionId') matchConnectionId: string,
    @Body() dto: SaveDraftDto,
  ) {
    const contract = await this.leaseContractsService.saveDraft(
      req.user.userId,
      matchConnectionId,
      dto,
    );
    return this.withAbsolutePdfUrl(contract);
  }

  @HttpCode(HttpStatus.OK)
  @Post('send-for-review')
  async sendForReview(
    @Request() req: { user: { userId: string } },
    @Param('matchConnectionId') matchConnectionId: string,
  ) {
    const contract = await this.leaseContractsService.sendForReview(
      req.user.userId,
      matchConnectionId,
    );
    return this.withAbsolutePdfUrl(contract);
  }

  @HttpCode(HttpStatus.OK)
  @Post('approve')
  async approve(
    @Request() req: { user: { userId: string } },
    @Param('matchConnectionId') matchConnectionId: string,
  ) {
    const contract = await this.leaseContractsService.approve(
      req.user.userId,
      matchConnectionId,
    );
    return this.withAbsolutePdfUrl(contract);
  }

  @HttpCode(HttpStatus.OK)
  @Post('reject')
  async reject(
    @Request() req: { user: { userId: string } },
    @Param('matchConnectionId') matchConnectionId: string,
    @Body() dto: RejectDraftDto,
  ) {
    const contract = await this.leaseContractsService.reject(
      req.user.userId,
      matchConnectionId,
      dto,
    );
    return this.withAbsolutePdfUrl(contract);
  }

  /** Same origin-resolution as AdminController's KYC image URLs. */
  private withAbsolutePdfUrl<T extends { pdfUrl: string | null }>(
    contract: T,
  ): T {
    if (!contract.pdfUrl) return contract;
    return {
      ...contract,
      pdfUrl: new URL(contract.pdfUrl, this.publicBackendOrigin()).toString(),
    };
  }

  private publicBackendOrigin(): string {
    const value = this.configService.get<string>('BACKEND_PUBLIC_URL')?.trim();
    if (!value) return 'http://localhost:3001';
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('BACKEND_PUBLIC_URL must use http or https');
    }
    return url.toString().replace(/\/$/, '');
  }
}

/**
 * Canonical, ID-addressed retrieval — the frontend routes to this once a
 * contract exists, rather than re-deriving "the" contract for a
 * (landlord, tenant) pair.
 */
@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class LeaseContractByIdController {
  constructor(
    private readonly leaseContractsService: LeaseContractsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  list(@Request() req: { user: { userId: string } }) {
    return this.leaseContractsService.listForUser(req.user.userId);
  }

  @Get(':id')
  async getById(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    const contract = await this.leaseContractsService.getById(
      req.user.userId,
      id,
    );
    return this.withAbsolutePdfUrl(contract);
  }

  @Get(':id/pdf')
  async downloadDraftPdf(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.leaseContractsService.downloadDraftPdf(req.user.userId, id);
    const safeId = id.replace(/[^a-zA-Z0-9-]/g, '');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `attachment; filename="rental-contract-draft-${safeId}.pdf"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(pdf);
  }

  @Post(':id/review/request-changes')
  @UseGuards(VerifiedGuard)
  requestChanges(@Request() req: { user: { userId: string } }, @Param('id') id: string, @Body() dto: RequestContractChangesDto) {
    return this.leaseContractsService.requestChanges(req.user.userId, id, dto);
  }

  @Post(':id/review/confirm')
  @UseGuards(VerifiedGuard)
  confirmReview(@Request() req: { user: { userId: string } }, @Param('id') id: string, @Body() dto: ConfirmContractReviewDto) {
    return this.leaseContractsService.confirmReview(req.user.userId, id, dto);
  }

  private withAbsolutePdfUrl<T extends { pdfUrl: string | null }>(
    contract: T,
  ): T {
    if (!contract.pdfUrl) return contract;
    return {
      ...contract,
      pdfUrl: new URL(contract.pdfUrl, this.publicBackendOrigin()).toString(),
    };
  }

  private publicBackendOrigin(): string {
    const value = this.configService.get<string>('BACKEND_PUBLIC_URL')?.trim();
    if (!value) return 'http://localhost:3001';
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('BACKEND_PUBLIC_URL must use http or https');
    }
    return url.toString().replace(/\/$/, '');
  }
}
