import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RealtimeService } from 'src/realtime/realtime.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { PrivateObjectStorage } from '../storage/private-object-storage.interface';
import { PRIVATE_OBJECT_STORAGE } from '../storage/private-object-storage.token';
import {
  ConfirmContractReviewDto,
  RequestContractChangesDto,
} from './dto/contract-review.dto';
import { LeaseContractDraftResponseDto } from './dto/lease-contract-draft-response.dto';
import { RejectDraftDto } from './dto/reject-draft.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import { leaseContractStatusToWire } from './lease-contract-status.mapper';
import {
  buildLeaseContractHtml,
  buildLeaseContractPdfFooterHtml,
} from './lease-contract-template';
import { PdfRendererService } from './pdf-renderer.service';
import { buildRentalContractDraftPdfHtml } from './rental-contract-draft-pdf.template';

const PDF_URL_TTL_SECONDS = 300;

interface LeaseContractRecord {
  id: string;
  matchConnectionId: string;
  status: 'DRAFTING' | 'PENDING_TENANT_APPROVAL' | 'APPROVED';
  ownerName: string;
  ownerNationalId: string | null;
  tenantName: string;
  tenantNationalId: string | null;
  propertyAddress: string;
  customClauses: string[];
  witness1Name: string | null;
  witness1NationalId: string | null;
  witness2Name: string | null;
  witness2NationalId: string | null;
  changeRequestNote: string | null;
  pdfUrl: string | null;
  startDate: Date;
  endDate: Date;
  rentAmount: number;
  createdAt: Date;
  updatedAt: Date;
  tenantReviewStatus:
    'PENDING_REVIEW' | 'CHANGES_REQUESTED' | 'REVIEW_CONFIRMED';
  tenantChangeRequest: string | null;
  tenantChangeRequestedAt: Date | null;
  tenantReviewConfirmedAt: Date | null;
  draftRevision: number;
  tenantReviewedRevision: number | null;
}

@Injectable()
export class LeaseContractsService {
  private readonly logger = new Logger(LeaseContractsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfRenderer: PdfRendererService,
    private readonly realtime: RealtimeService,
    @Inject(PRIVATE_OBJECT_STORAGE)
    private readonly storage: PrivateObjectStorage,
  ) {}

  /** Every lease-contract notification deep-links to the same entry point —
   * it branches by role/status on its own (drafting canvas, read-only
   * review, or the final /contracts/[id] redirect once generated). */
  private contractLink(matchConnectionId: string): string {
    return `/contracts/new?matchConnectionId=${matchConnectionId}`;
  }

  /**
   * What the Hybrid Contract Builder canvas needs to render before any
   * draft exists — owner/tenant/address are real (server-derived, IDs
   * masked); rent is a suggestion the landlord can still override.
   */
  async getPrefill(userId: string, matchConnectionId: string) {
    const match = await this.connectedMatchFor(userId, matchConnectionId);
    return {
      ownerName: match.owner.fullName,
      tenantName: match.tenant.fullName,
      propertyAddress: `${match.property.district}، ${match.property.manualAddress}`,
      suggestedRentAmount: match.property.rentAmount,
    };
  }

  /** Landlord only. Creates or updates the draft — no PDF yet. Locked once
   * the draft has been sent for tenant review. */
  async saveDraft(
    userId: string,
    matchConnectionId: string,
    dto: SaveDraftDto,
  ) {
    const match = await this.connectedMatchFor(userId, matchConnectionId);
    if (userId !== match.ownerId) {
      throw new ForbiddenException('ONLY_LANDLORD_MAY_EDIT_DRAFT');
    }

    const existing = await this.prisma.leaseContract.findUnique({
      where: { matchConnectionId },
      select: { status: true, tenantReviewStatus: true },
    });
    if (existing?.tenantReviewStatus === 'REVIEW_CONFIRMED') {
      throw new ConflictException('CONTRACT_DRAFT_LOCKED');
    }
    // Legacy rows may retain PENDING_TENANT_APPROVAL. A tenant's new-review
    // change request is the explicit unlock signal for that one transition.
    if (
      existing &&
      existing.status !== 'DRAFTING' &&
      existing.tenantReviewStatus !== 'CHANGES_REQUESTED'
    ) {
      throw new ConflictException('DRAFT_LOCKED');
    }

    const startDate = this.parseCalendarDate(dto.startDate, 'startDate');
    const endDate = this.parseCalendarDate(dto.endDate, 'endDate');
    if (endDate <= startDate) {
      throw new BadRequestException('END_DATE_MUST_BE_AFTER_START_DATE');
    }
    const ownerName = this.requireTrustedText(
      match.owner.fullName,
      200,
      'OWNER_NAME',
    );
    const tenantName = this.requireTrustedText(
      match.tenant.fullName,
      200,
      'TENANT_NAME',
    );
    const propertyAddress = this.requireTrustedText(
      `${match.property.district}، ${match.property.manualAddress}`,
      500,
      'PROPERTY_ADDRESS',
    );
    const rentAmount = dto.rentAmount ?? match.property.rentAmount;
    if (!Number.isFinite(rentAmount) || rentAmount <= 0) {
      throw new BadRequestException('RENT_AMOUNT_MUST_BE_POSITIVE');
    }
    const customClauses = this.normalizeCustomClauses(dto.customClauses ?? []);

    const data = {
      generatedByUserId: userId,
      ownerName,
      tenantName,
      propertyAddress,
      rentAmount,
      startDate,
      endDate,
      customClauses,
      witness1Name: dto.witness1Name ?? null,
      witness1NationalId: dto.witness1NationalId ?? null,
      witness2Name: dto.witness2Name ?? null,
      witness2NationalId: dto.witness2NationalId ?? null,
      status: 'DRAFTING' as const,
    };
    if (!existing) {
      const contract = await this.prisma.leaseContract.create({
        data: { matchConnectionId, ...data },
      });
      return this.toResponse(contract, userId, match);
    }

    // The status predicate is deliberately repeated in the write. A tenant
    // confirmation between the read above and this write must not be lost.
    const result = await this.prisma.leaseContract.updateMany({
      where: {
        matchConnectionId,
        tenantReviewStatus: { not: 'REVIEW_CONFIRMED' },
      },
      data: {
        ...data,
        draftRevision: { increment: 1 },
        tenantReviewStatus: 'PENDING_REVIEW',
        tenantChangeRequest: null,
        tenantChangeRequestedAt: null,
      },
    });
    if (result.count !== 1) {
      throw new ConflictException('CONTRACT_DRAFT_LOCKED');
    }
    const contract = await this.requireContract(matchConnectionId);
    if (existing.tenantReviewStatus === 'CHANGES_REQUESTED') {
      await this.realtime.notifyUser(match.tenantId, {
        type: 'NEW_REVIEW_SUBMITTED',
        title: 'Updated contract draft',
        message: 'The landlord saved an updated draft for your review.',
        link: `/contracts/${contract.id}`,
      });
    }
    return this.toResponse(contract, userId, match);
  }

  /** Landlord only. Locks the draft for tenant review. */
  async sendForReview(userId: string, matchConnectionId: string) {
    const match = await this.connectedMatchFor(userId, matchConnectionId);
    if (userId !== match.ownerId) {
      throw new ForbiddenException('ONLY_LANDLORD_MAY_SEND_FOR_REVIEW');
    }
    const contract = await this.requireContract(matchConnectionId);
    if (contract.status !== 'DRAFTING') {
      throw new ConflictException('NOT_IN_DRAFTING_STATE');
    }
    const updated = await this.prisma.leaseContract.update({
      where: { matchConnectionId },
      data: { status: 'PENDING_TENANT_APPROVAL', changeRequestNote: null },
    });
    await this.realtime.notifyUser(match.tenantId, {
      type: 'CONTRACT_READY_FOR_REVIEW',
      title: 'عقد إيجار بانتظار مراجعتك',
      message: 'أرسل المالك مسودة العقد لمراجعتك.',
      link: this.contractLink(matchConnectionId),
    });
    return this.toResponse(updated);
  }

  /**
   * Tenant only. This is the only path that ever produces a PDF — the
   * `generatedByUserId` on the row becomes the tenant's id, reflecting them
   * as the final approver, not whoever drafted it.
   */
  async approve(userId: string, matchConnectionId: string) {
    const match = await this.connectedMatchFor(userId, matchConnectionId);
    if (userId !== match.tenantId) {
      throw new ForbiddenException('ONLY_TENANT_MAY_APPROVE');
    }
    const contract = await this.requireContract(matchConnectionId);
    // APPROVED is the final rental-deal state: the tenant has approved the
    // contract and its PDF was generated. Repair a missing archive/vector
    // cleanup on retries without generating another PDF or changing the deal.
    if (contract.status === 'APPROVED') {
      return this.toResponse(contract);
    }
    if (contract.status !== 'PENDING_TENANT_APPROVAL') {
      throw new ConflictException('NOT_PENDING_TENANT_APPROVAL');
    }

    const [ownerVerification, tenantVerification] = await Promise.all([
      this.prisma.identityVerification.findUnique({
        where: { userId: match.ownerId },
        select: { nationalId: true, status: true },
      }),
      this.prisma.identityVerification.findUnique({
        where: { userId: match.tenantId },
        select: { nationalId: true, status: true },
      }),
    ]);
    if (
      ownerVerification?.status !== 'APPROVED' ||
      tenantVerification?.status !== 'APPROVED'
    ) {
      throw new ConflictException('IDENTITY_NOT_VERIFIED');
    }

    const html = buildLeaseContractHtml({
      ownerName: contract.ownerName,
      ownerNationalId: ownerVerification.nationalId,
      tenantName: contract.tenantName,
      tenantNationalId: tenantVerification.nationalId,
      propertyAddress: contract.propertyAddress,
      rentAmount: contract.rentAmount,
      startDate: contract.startDate,
      endDate: contract.endDate,
      customClauses: contract.customClauses,
      witness1Name: contract.witness1Name,
      witness1NationalId: contract.witness1NationalId,
      witness2Name: contract.witness2Name,
      witness2NationalId: contract.witness2NationalId,
      generatedAt: new Date(),
    });
    const pdf = await this.pdfRenderer.renderHtmlToPdf(
      html,
      buildLeaseContractPdfFooterHtml(),
    );
    const { objectKey } = await this.storage.upload({
      data: pdf,
      contentType: 'application/pdf',
      category: 'contracts',
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const approvedContract = await tx.leaseContract.update({
        where: { matchConnectionId },
        data: {
          generatedByUserId: userId,
          ownerNationalId: ownerVerification.nationalId,
          tenantNationalId: tenantVerification.nationalId,
          pdfUrl: objectKey,
          status: 'APPROVED',
        },
      });
      return approvedContract;
    });
    await this.realtime.notifyUser(match.ownerId, {
      type: 'CONTRACT_APPROVED',
      title: 'تمت الموافقة على العقد',
      message: 'وافق المستأجر على العقد وتم توليد ملف PDF.',
      link: `/contracts/${updated.id}`,
    });
    return this.toResponse(updated);
  }

  /** Tenant only. Unlocks the draft for the landlord to revise. */
  async reject(userId: string, matchConnectionId: string, dto: RejectDraftDto) {
    const match = await this.connectedMatchFor(userId, matchConnectionId);
    if (userId !== match.tenantId) {
      throw new ForbiddenException('ONLY_TENANT_MAY_REJECT');
    }
    const contract = await this.requireContract(matchConnectionId);
    if (contract.status !== 'PENDING_TENANT_APPROVAL') {
      throw new ConflictException('NOT_PENDING_TENANT_APPROVAL');
    }
    const updated = await this.prisma.leaseContract.update({
      where: { matchConnectionId },
      data: {
        status: 'DRAFTING',
        changeRequestNote: dto.note?.trim() || null,
      },
    });
    await this.realtime.notifyUser(match.ownerId, {
      type: 'CONTRACT_REJECTED',
      title: 'طلب المستأجر تعديلات على العقد',
      message: 'طلب المستأجر إجراء تعديلات على مسودة العقد.',
      link: this.contractLink(matchConnectionId),
    });
    return this.toResponse(updated);
  }

  async getForMatch(userId: string, matchConnectionId: string) {
    const match = await this.connectedMatchFor(userId, matchConnectionId);
    const contract = await this.requireContract(matchConnectionId);
    return this.toResponse(contract, userId, match);
  }

  /**
   * Fetch a contract by its own primary key — the canonical, isolated way
   * to retrieve one specific transaction's contract. A different unit
   * later between the same two people is a different MatchConnection and
   * therefore a different LeaseContract row.
   */
  async getById(userId: string, contractId: string) {
    const contract = await this.prisma.leaseContract.findUnique({
      where: { id: contractId },
      include: {
        matchConnection: { select: { tenantId: true, ownerId: true } },
      },
    });
    if (!contract) {
      throw new NotFoundException('LEASE_CONTRACT_NOT_FOUND');
    }
    const { matchConnection, ...record } = contract;
    if (
      matchConnection.tenantId !== userId &&
      matchConnection.ownerId !== userId
    ) {
      throw new ForbiddenException('NOT_A_PARTY_TO_THIS_CONTRACT');
    }
    return this.toResponse(record, userId, matchConnection);
  }

  async listForUser(userId: string) {
    const contracts = await this.prisma.leaseContract.findMany({
      where: {
        matchConnection: { OR: [{ tenantId: userId }, { ownerId: userId }] },
      },
      include: {
        matchConnection: {
          select: {
            tenantId: true,
            ownerId: true,
            propertyId: true,
            property: { select: { title: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      items: await Promise.all(
        contracts.map(async ({ matchConnection, ...contract }) => ({
          ...(await this.toResponse(contract, userId, matchConnection)),
          propertyId: matchConnection.propertyId,
          propertyTitle: matchConnection.property.title,
        })),
      ),
    };
  }

  async requestChanges(
    userId: string,
    contractId: string,
    dto: RequestContractChangesDto,
  ) {
    const contract = await this.authorizedContract(userId, contractId, true);
    if (contract.tenantReviewStatus === 'REVIEW_CONFIRMED')
      throw new ConflictException('CONTRACT_REVIEW_ALREADY_CONFIRMED');
    if (contract.tenantReviewStatus === 'CHANGES_REQUESTED')
      throw new ConflictException('CONTRACT_CHANGES_ALREADY_REQUESTED');
    const message = dto.message.trim();
    if (message.length < 5)
      throw new BadRequestException('CHANGE_REQUEST_TOO_SHORT');
    const changed = await this.prisma.leaseContract.updateMany({
      where: { id: contractId, tenantReviewStatus: 'PENDING_REVIEW' },
      data: {
        tenantReviewStatus: 'CHANGES_REQUESTED',
        tenantChangeRequest: message,
        tenantChangeRequestedAt: new Date(),
      },
    });
    if (changed.count !== 1) {
      const current = await this.authorizedContract(userId, contractId, true);
      if (current.tenantReviewStatus === 'REVIEW_CONFIRMED') {
        throw new ConflictException('CONTRACT_REVIEW_ALREADY_CONFIRMED');
      }
      throw new ConflictException('CONTRACT_CHANGES_ALREADY_REQUESTED');
    }
    const updated = await this.authorizedContract(userId, contractId, true);
    await this.realtime.notifyUser(contract.matchConnection.ownerId, {
      type: 'NEW_REVIEW_SUBMITTED',
      title: 'Contract changes requested',
      message: 'The tenant requested changes to the contract draft.',
      link: `/contracts/${contractId}`,
    });
    return this.toResponse(updated, userId, contract.matchConnection);
  }

  async confirmReview(
    userId: string,
    contractId: string,
    dto: ConfirmContractReviewDto,
  ) {
    const contract = await this.authorizedContract(userId, contractId, true);
    if (contract.tenantReviewStatus === 'REVIEW_CONFIRMED')
      return this.toResponse(contract, userId, contract.matchConnection);
    if (contract.tenantReviewStatus === 'CHANGES_REQUESTED')
      throw new ConflictException('CONTRACT_CHANGES_PENDING');
    if (dto.expectedRevision !== contract.draftRevision)
      throw new ConflictException('CONTRACT_REVISION_CHANGED');
    const changed = await this.prisma.leaseContract.updateMany({
      where: {
        id: contractId,
        tenantReviewStatus: 'PENDING_REVIEW',
        draftRevision: dto.expectedRevision,
      },
      data: {
        tenantReviewStatus: 'REVIEW_CONFIRMED',
        tenantReviewConfirmedAt: new Date(),
        tenantReviewedRevision: dto.expectedRevision,
        tenantChangeRequest: null,
        tenantChangeRequestedAt: null,
      },
    });
    if (changed.count !== 1) {
      const current = await this.authorizedContract(userId, contractId, true);
      if (current.tenantReviewStatus === 'REVIEW_CONFIRMED') {
        return this.toResponse(current, userId, current.matchConnection);
      }
      if (current.tenantReviewStatus === 'CHANGES_REQUESTED') {
        throw new ConflictException('CONTRACT_CHANGES_PENDING');
      }
      throw new ConflictException('CONTRACT_REVISION_CHANGED');
    }
    const updated = await this.authorizedContract(userId, contractId, true);
    await this.realtime.notifyUser(contract.matchConnection.ownerId, {
      type: 'REVIEW_APPROVED',
      title: 'Contract draft review confirmed',
      message: 'The tenant confirmed review of the current draft.',
      link: `/contracts/${contractId}`,
    });
    return this.toResponse(updated, userId, contract.matchConnection);
  }

  /** Generates bytes in memory only; the saved contract is never mutated or stored. */
  async downloadDraftPdf(userId: string, contractId: string): Promise<Buffer> {
    const contract = await this.prisma.leaseContract.findUnique({
      where: { id: contractId },
      include: {
        matchConnection: { select: { tenantId: true, ownerId: true } },
      },
    });
    if (!contract) throw new NotFoundException('LEASE_CONTRACT_NOT_FOUND');
    if (
      contract.matchConnection.tenantId !== userId &&
      contract.matchConnection.ownerId !== userId
    ) {
      throw new ForbiddenException('NOT_A_PARTY_TO_THIS_CONTRACT');
    }
    if (
      contract.status !== 'DRAFTING' ||
      contract.tenantReviewStatus !== 'REVIEW_CONFIRMED'
    ) {
      throw new ConflictException('PDF_DOWNLOAD_REQUIRES_CONFIRMED_REVIEW');
    }
    return this.pdfRenderer.renderHtmlToPdf(
      buildRentalContractDraftPdfHtml({
        contractId: contract.id,
        ownerName: contract.ownerName,
        tenantName: contract.tenantName,
        propertyAddress: contract.propertyAddress,
        rentAmount: contract.rentAmount,
        startDate: contract.startDate,
        endDate: contract.endDate,
        customClauses: contract.customClauses,
        generatedAt: new Date(),
      }),
    );
  }

  private async requireContract(matchConnectionId: string) {
    const contract = await this.prisma.leaseContract.findUnique({
      where: { matchConnectionId },
    });
    if (!contract) {
      throw new NotFoundException('LEASE_CONTRACT_NOT_FOUND');
    }
    return contract;
  }

  /** Only the two real parties of a CONNECTED match may draft/review/approve its lease. */
  private async connectedMatchFor(userId: string, matchConnectionId: string) {
    const match = await this.prisma.matchConnection.findFirst({
      where: {
        id: matchConnectionId,
        status: 'CONNECTED',
        OR: [{ tenantId: userId }, { ownerId: userId }],
      },
      include: {
        owner: { select: { fullName: true } },
        tenant: { select: { fullName: true } },
        property: {
          select: { district: true, manualAddress: true, rentAmount: true },
        },
      },
    });
    if (!match) {
      throw new NotFoundException('MATCH_CONNECTION_NOT_FOUND');
    }
    return match;
  }

  private async authorizedContract(
    userId: string,
    contractId: string,
    tenantOnly = false,
  ) {
    const contract = await this.prisma.leaseContract.findUnique({
      where: { id: contractId },
      include: {
        matchConnection: { select: { tenantId: true, ownerId: true } },
      },
    });
    if (!contract) throw new NotFoundException('LEASE_CONTRACT_NOT_FOUND');
    if (
      tenantOnly
        ? contract.matchConnection.tenantId !== userId
        : contract.matchConnection.tenantId !== userId &&
          contract.matchConnection.ownerId !== userId
    )
      throw new ForbiddenException('NOT_A_PARTY_TO_THIS_CONTRACT');
    return contract;
  }

  private async toResponse(
    contract: LeaseContractRecord,
    userId?: string,
    parties?: { tenantId: string; ownerId: string },
  ): Promise<
    LeaseContractDraftResponseDto & {
      changeRequestNote: string | null;
      witness1Name: string | null;
      witness2Name: string | null;
      pdfUrl: string | null;
    }
  > {
    const pdfUrl = contract.pdfUrl
      ? await this.storage.createTemporaryReadUrl(
          contract.pdfUrl,
          PDF_URL_TTL_SECONDS,
        )
      : null;
    return {
      id: contract.id,
      matchConnectionId: contract.matchConnectionId,
      status: leaseContractStatusToWire(contract.status),
      changeRequestNote: contract.changeRequestNote,
      ownerName: contract.ownerName,
      tenantName: contract.tenantName,
      propertyAddress: contract.propertyAddress,
      customClauses: contract.customClauses,
      witness1Name: contract.witness1Name,
      witness2Name: contract.witness2Name,
      rentAmount: contract.rentAmount,
      startDate: contract.startDate.toISOString(),
      endDate: contract.endDate.toISOString(),
      createdAt: contract.createdAt.toISOString(),
      updatedAt: contract.updatedAt.toISOString(),
      pdfUrl,
      disclaimer: {
        // `toResponse` is also used by the legacy review route; only the
        // approved legacy state is no longer a draft. New rows are DRAFTING.
        isDraft: contract.status !== 'APPROVED',
        isElectronicSignature: false,
        isLegallyAuthenticated: false,
        message:
          'هذه مسودة عقد إيجار للمراجعة فقط، وليست توقيعًا إلكترونيًا أو توثيقًا قانونيًا أو تسجيلًا حكوميًا. راجعها قبل التوقيع أو الاعتماد عليها.',
      },
      tenantReviewStatus: contract.tenantReviewStatus,
      tenantChangeRequest: contract.tenantChangeRequest,
      tenantChangeRequestedAt:
        contract.tenantChangeRequestedAt?.toISOString() ?? null,
      tenantReviewConfirmedAt:
        contract.tenantReviewConfirmedAt?.toISOString() ?? null,
      draftRevision: contract.draftRevision,
      tenantReviewedRevision: contract.tenantReviewedRevision,
      canEdit: Boolean(
        parties &&
        parties.ownerId === userId &&
        contract.tenantReviewStatus !== 'REVIEW_CONFIRMED',
      ),
      canRequestChanges: Boolean(
        parties &&
        parties.tenantId === userId &&
        contract.tenantReviewStatus === 'PENDING_REVIEW',
      ),
      canConfirmReview: Boolean(
        parties &&
        parties.tenantId === userId &&
        contract.tenantReviewStatus === 'PENDING_REVIEW',
      ),
      canDownloadPdf: contract.tenantReviewStatus === 'REVIEW_CONFIRMED',
    };
  }

  /** Parse date-only ISO input at UTC midnight without JS date rollover. */
  private parseCalendarDate(value: string, field: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${field.toUpperCase()}_MUST_BE_ISO_DATE`);
    }
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new BadRequestException(`${field.toUpperCase()}_IS_INVALID`);
    }
    return date;
  }

  private normalizeCustomClauses(clauses: string[]): string[] {
    if (clauses.length > 30) {
      throw new BadRequestException('TOO_MANY_CUSTOM_CLAUSES');
    }
    return clauses.map((clause) => {
      if (typeof clause !== 'string') {
        throw new BadRequestException('CUSTOM_CLAUSE_MUST_BE_TEXT');
      }
      const normalized = clause.trim();
      if (!normalized || normalized.length > 2000) {
        throw new BadRequestException('CUSTOM_CLAUSE_IS_INVALID');
      }
      return normalized;
    });
  }

  private requireTrustedText(
    value: string,
    maximum: number,
    field: string,
  ): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > maximum) {
      throw new ConflictException(`TRUSTED_${field}_IS_INVALID`);
    }
    return normalized;
  }
}
