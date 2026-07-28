import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { PrivateObjectStorage } from '../storage/private-object-storage.interface';
import { PRIVATE_OBJECT_STORAGE } from '../storage/private-object-storage.token';
import { RejectDraftDto } from './dto/reject-draft.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import {
  buildLeaseContractHtml,
  buildLeaseContractPdfFooterHtml,
} from './lease-contract-template';
import { leaseContractStatusToWire } from './lease-contract-status.mapper';
import { PdfRendererService } from './pdf-renderer.service';

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
}

@Injectable()
export class LeaseContractsService {
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
    const [ownerVerification, tenantVerification] = await Promise.all([
      this.prisma.identityVerification.findUnique({
        where: { userId: match.ownerId },
        select: { nationalId: true },
      }),
      this.prisma.identityVerification.findUnique({
        where: { userId: match.tenantId },
        select: { nationalId: true },
      }),
    ]);
    return {
      ownerName: match.owner.fullName,
      ownerNationalId: ownerVerification?.nationalId
        ? this.maskNationalId(ownerVerification.nationalId)
        : null,
      tenantName: match.tenant.fullName,
      tenantNationalId: tenantVerification?.nationalId
        ? this.maskNationalId(tenantVerification.nationalId)
        : null,
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
      select: { status: true },
    });
    if (existing && existing.status !== 'DRAFTING') {
      throw new ConflictException('DRAFT_LOCKED');
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new ConflictException('END_DATE_BEFORE_START_DATE');
    }
    const customClauses = (dto.customClauses ?? [])
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const data = {
      generatedByUserId: userId,
      ownerName: match.owner.fullName,
      tenantName: match.tenant.fullName,
      propertyAddress: `${match.property.district}، ${match.property.manualAddress}`,
      rentAmount: dto.rentAmount ?? match.property.rentAmount,
      startDate,
      endDate,
      customClauses,
      witness1Name: dto.witness1Name ?? null,
      witness1NationalId: dto.witness1NationalId ?? null,
      witness2Name: dto.witness2Name ?? null,
      witness2NationalId: dto.witness2NationalId ?? null,
      status: 'DRAFTING' as const,
    };
    const contract = await this.prisma.leaseContract.upsert({
      where: { matchConnectionId },
      create: { matchConnectionId, ...data },
      update: data,
    });
    return this.toResponse(contract);
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
    if (contract.status !== 'PENDING_TENANT_APPROVAL') {
      throw new ConflictException('NOT_PENDING_TENANT_APPROVAL');
    }

    const [ownerVerification, tenantVerification] = await Promise.all([
      this.prisma.identityVerification.findUnique({
        where: { userId: match.ownerId },
        select: { nationalId: true },
      }),
      this.prisma.identityVerification.findUnique({
        where: { userId: match.tenantId },
        select: { nationalId: true },
      }),
    ]);
    if (!ownerVerification?.nationalId || !tenantVerification?.nationalId) {
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

    const updated = await this.prisma.leaseContract.update({
      where: { matchConnectionId },
      data: {
        generatedByUserId: userId,
        ownerNationalId: ownerVerification.nationalId,
        tenantNationalId: tenantVerification.nationalId,
        pdfUrl: objectKey,
        status: 'APPROVED',
      },
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
    await this.connectedMatchFor(userId, matchConnectionId);
    const contract = await this.requireContract(matchConnectionId);
    return this.toResponse(contract);
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
    return this.toResponse(record);
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

  private maskNationalId(id: string): string {
    return id.length <= 4 ? id : `${'*'.repeat(id.length - 4)}${id.slice(-4)}`;
  }

  private async toResponse(contract: LeaseContractRecord) {
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
      // National IDs never leave the backend in full outside the PDF itself.
      ownerNationalId: contract.ownerNationalId
        ? this.maskNationalId(contract.ownerNationalId)
        : null,
      tenantNationalId: contract.tenantNationalId
        ? this.maskNationalId(contract.tenantNationalId)
        : null,
      propertyAddress: contract.propertyAddress,
      customClauses: contract.customClauses,
      witness1Name: contract.witness1Name,
      witness1NationalId: contract.witness1NationalId
        ? this.maskNationalId(contract.witness1NationalId)
        : null,
      witness2Name: contract.witness2Name,
      witness2NationalId: contract.witness2NationalId
        ? this.maskNationalId(contract.witness2NationalId)
        : null,
      rentAmount: contract.rentAmount,
      startDate: contract.startDate.toISOString(),
      endDate: contract.endDate.toISOString(),
      createdAt: contract.createdAt.toISOString(),
      pdfUrl,
    };
  }
}
