import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PRIVATE_OBJECT_STORAGE } from '../storage/private-object-storage.token';
import { LeaseContractsService } from './lease-contracts.service';
import { PdfRendererService } from './pdf-renderer.service';
import { RealtimeService } from '../realtime/realtime.service';

const ownerId = '11111111-1111-1111-1111-111111111111';
const tenantId = '22222222-2222-2222-2222-222222222222';
const otherId = '33333333-3333-3333-3333-333333333333';
const matchId = '44444444-4444-4444-4444-444444444444';

describe('LeaseContractsService draft API', () => {
  let service: LeaseContractsService;
  let prisma: any;
  let storage: { upload: jest.Mock; createTemporaryReadUrl: jest.Mock };
  let renderer: { renderHtmlToPdf: jest.Mock };
  let realtime: { notifyUser: jest.Mock };

  const match = {
    id: matchId,
    propertyId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    status: 'CONNECTED',
    ownerId,
    tenantId,
    owner: { fullName: 'Owner Name' },
    tenant: { fullName: 'Tenant Name' },
    property: {
      district: 'Maadi',
      manualAddress: '12 Street',
      rentAmount: 12000,
    },
  };

  const record = (overrides: Record<string, unknown> = {}) => ({
    id: '55555555-5555-5555-5555-555555555555',
    matchConnectionId: matchId,
    generatedByUserId: ownerId,
    ownerName: 'Owner Name',
    ownerNationalId: null,
    tenantName: 'Tenant Name',
    tenantNationalId: null,
    propertyAddress: 'Maadi، 12 Street',
    customClauses: ['No pets'],
    witness1Name: null,
    witness1NationalId: null,
    witness2Name: null,
    witness2NationalId: null,
    pdfUrl: null,
    startDate: new Date('2026-08-01T00:00:00.000Z'),
    endDate: new Date('2027-07-31T00:00:00.000Z'),
    rentAmount: 12000,
    status: 'DRAFTING',
    changeRequestNote: null,
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
    updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    tenantReviewStatus: 'PENDING_REVIEW',
    tenantChangeRequest: null,
    tenantChangeRequestedAt: null,
    tenantReviewConfirmedAt: null,
    draftRevision: 1,
    tenantReviewedRevision: null,
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      matchConnection: { findFirst: jest.fn().mockResolvedValue(match) },
      leaseContract: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(
          record({
            tenantReviewStatus: 'PENDING_REVIEW',
            draftRevision: 1,
            tenantChangeRequest: null,
            tenantChangeRequestedAt: null,
            tenantReviewConfirmedAt: null,
            tenantReviewedRevision: null,
          }),
        ),
        update: jest.fn().mockResolvedValue(record({ status: 'APPROVED' })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      identityVerification: { findUnique: jest.fn() },
    };
    prisma.$transaction = (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        leaseContract: { update: prisma.leaseContract.update },
      });
    storage = { upload: jest.fn(), createTemporaryReadUrl: jest.fn() };
    renderer = {
      renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')),
    };
    realtime = { notifyUser: jest.fn().mockResolvedValue({}) };
    const module = await Test.createTestingModule({
      providers: [
        LeaseContractsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PdfRendererService, useValue: renderer },
        { provide: RealtimeService, useValue: realtime },
        { provide: PRIVATE_OBJECT_STORAGE, useValue: storage },
      ],
    }).compile();
    service = module.get(LeaseContractsService);
  });

  const validDraft = () => ({
    rentAmount: 12500,
    startDate: '2026-08-01',
    endDate: '2027-07-31',
    customClauses: ['  No pets  '],
  });

  it('allows the connected landlord to create a DRAFTING-only contract response', async () => {
    const response = await service.saveDraft(ownerId, matchId, validDraft());
    expect(prisma.leaseContract.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchConnectionId: matchId,
          generatedByUserId: ownerId,
          status: 'DRAFTING',
          customClauses: ['No pets'],
        }),
      }),
    );
    expect(response.status).toBe('drafting');
    expect(response.disclaimer).toEqual(
      expect.objectContaining({
        isDraft: true,
        isElectronicSignature: false,
        isLegallyAuthenticated: false,
      }),
    );
    expect(response).not.toHaveProperty('ownerNationalId');
    expect(response).not.toHaveProperty('tenantNationalId');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN])(
    'rejects non-positive or non-finite rent %p',
    async (rentAmount) => {
      await expect(
        service.saveDraft(ownerId, matchId, { ...validDraft(), rentAmount }),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it.each([
    ['2026-02-30', '2027-07-31'],
    ['2026-08-01', '2027-02-30'],
    ['2026-08-01', '2026-08-01'],
    ['2026-08-02', '2026-08-01'],
  ])(
    'rejects invalid or non-forward date ranges',
    async (startDate, endDate) => {
      await expect(
        service.saveDraft(ownerId, matchId, {
          ...validDraft(),
          startDate,
          endDate,
        }),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('rejects empty and overlong custom clauses', async () => {
    await expect(
      service.saveDraft(ownerId, matchId, {
        ...validDraft(),
        customClauses: ['   '],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.saveDraft(ownerId, matchId, {
        ...validDraft(),
        customClauses: ['x'.repeat(2001)],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not let the tenant or an unrelated user create the landlord draft', async () => {
    await expect(
      service.saveDraft(tenantId, matchId, validDraft()),
    ).rejects.toThrow(ForbiddenException);
    prisma.matchConnection.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.saveDraft(otherId, matchId, validDraft()),
    ).rejects.toThrow();
  });

  it('permits only a party to read a contract and never serializes KYC fields', async () => {
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({ matchConnection: { ownerId, tenantId } }),
    );
    const response = await service.getById(
      tenantId,
      '55555555-5555-5555-5555-555555555555',
    );
    expect(response.ownerName).toBe('Owner Name');
    expect(response).not.toHaveProperty('ownerNationalId');
    expect(response).not.toHaveProperty('tenantNationalId');

    await expect(
      service.getById(otherId, '55555555-5555-5555-5555-555555555555'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows either party to generate an in-memory PDF only from a saved DRAFTING contract', async () => {
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({
        tenantReviewStatus: 'REVIEW_CONFIRMED',
        matchConnection: { ownerId, tenantId },
      }),
    );
    await expect(
      service.downloadPdf(ownerId, '55555555-5555-5555-5555-555555555555'),
    ).resolves.toEqual(Buffer.from('%PDF-test'));
    await expect(
      service.downloadPdf(tenantId, '55555555-5555-5555-5555-555555555555'),
    ).resolves.toEqual(Buffer.from('%PDF-test'));
    expect(renderer.renderHtmlToPdf).toHaveBeenCalledWith(
      expect.stringContaining('Owner Name'),
    );
    expect(prisma.leaseContract.create).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects unrelated readers and PDFs before both parties confirm review', async () => {
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({ matchConnection: { ownerId, tenantId } }),
    );
    await expect(
      service.downloadPdf(otherId, '55555555-5555-5555-5555-555555555555'),
    ).rejects.toThrow(ForbiddenException);
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({
        tenantReviewStatus: 'PENDING_REVIEW',
        matchConnection: { ownerId, tenantId },
      }),
    );
    await expect(
      service.downloadPdf(ownerId, '55555555-5555-5555-5555-555555555555'),
    ).rejects.toThrow(ConflictException);
  });

  it('lists only connected contracts in updatedAt descending order with calculated permissions', async () => {
    prisma.leaseContract.findMany = jest.fn().mockResolvedValue([
      {
        ...record({
          id: 'new',
          updatedAt: new Date('2026-07-29'),
          matchConnectionId: 'new-match',
        }),
        matchConnection: {
          ownerId,
          tenantId,
          propertyId: 'p1',
          property: { title: 'New' },
        },
      },
      {
        ...record({
          id: 'old',
          updatedAt: new Date('2026-07-28'),
          tenantReviewStatus: 'CHANGES_REQUESTED',
        }),
        matchConnection: {
          ownerId,
          tenantId,
          propertyId: 'p2',
          property: { title: 'Old' },
        },
      },
    ]);
    const response = await service.listForUser(ownerId);
    expect(prisma.leaseContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: 'desc' } }),
    );
    expect(response.items.map((item) => item.id)).toEqual(['new', 'old']);
    expect(response.items[0]).toEqual(
      expect.objectContaining({
        canEdit: true,
        canRequestChanges: false,
        canConfirmReview: false,
      }),
    );
    expect(response.items[0]).not.toHaveProperty('ownerNationalId');
  });

  it('conditionally records a tenant change request without changing revision', async () => {
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({ matchConnection: { ownerId, tenantId } }),
    );
    await service.requestChanges(
      tenantId,
      '55555555-5555-5555-5555-555555555555',
      { message: 'Please change the start date' },
    );
    expect(prisma.leaseContract.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantReviewStatus: 'PENDING_REVIEW',
        }),
      }),
    );
    expect(
      prisma.leaseContract.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('draftRevision');
  });

  it('rejects a duplicate change request and a confirmed draft with stable conflicts', async () => {
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({
        tenantReviewStatus: 'CHANGES_REQUESTED',
        matchConnection: { ownerId, tenantId },
      }),
    );
    await expect(
      service.requestChanges(tenantId, '55555555-5555-5555-5555-555555555555', {
        message: 'Again please',
      }),
    ).rejects.toThrow(ConflictException);
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({
        tenantReviewStatus: 'REVIEW_CONFIRMED',
        matchConnection: { ownerId, tenantId },
      }),
    );
    await expect(
      service.requestChanges(tenantId, '55555555-5555-5555-5555-555555555555', {
        message: 'Again please',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('conditionally confirms exactly the expected revision and is idempotent after confirmation', async () => {
    const pendingApproval = record({
      status: 'PENDING_TENANT_APPROVAL',
      tenantReviewStatus: 'REVIEW_CONFIRMED',
      tenantReviewedRevision: 3,
    });
    const approved = record({
      status: 'APPROVED',
      tenantReviewStatus: 'REVIEW_CONFIRMED',
      tenantReviewedRevision: 3,
      pdfUrl: 'contracts/final.pdf',
    });
    prisma.leaseContract.findUnique
      .mockResolvedValueOnce(
        record({ matchConnection: { ownerId, tenantId }, draftRevision: 3 }),
      )
      .mockResolvedValueOnce(pendingApproval);
    prisma.identityVerification.findUnique
      .mockResolvedValueOnce({ nationalId: null, status: 'APPROVED' })
      .mockResolvedValueOnce({ nationalId: null, status: 'APPROVED' });
    storage.upload.mockResolvedValue({ objectKey: 'contracts/final.pdf' });
    prisma.leaseContract.update.mockResolvedValue(approved);

    await expect(
      service.confirmReview(tenantId, '55555555-5555-5555-5555-555555555555', {
        expectedRevision: 3,
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 'generated' }));
    expect(prisma.leaseContract.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          draftRevision: 3,
          tenantReviewStatus: 'PENDING_REVIEW',
        }),
        data: expect.objectContaining({
          status: 'PENDING_TENANT_APPROVAL',
          tenantReviewStatus: 'REVIEW_CONFIRMED',
        }),
      }),
    );
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({
        matchConnection: { ownerId, tenantId },
        status: 'APPROVED',
        tenantReviewStatus: 'REVIEW_CONFIRMED',
        tenantReviewConfirmedAt: new Date(),
      }),
    );
    await expect(
      service.confirmReview(tenantId, '55555555-5555-5555-5555-555555555555', {
        expectedRevision: 1,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ tenantReviewStatus: 'REVIEW_CONFIRMED' }),
    );
  });

  it('finishes a contract left confirmed but drafting by the former flow', async () => {
    prisma.leaseContract.findUnique
      .mockResolvedValueOnce(
        record({
          status: 'DRAFTING',
          tenantReviewStatus: 'REVIEW_CONFIRMED',
          tenantReviewedRevision: 1,
          matchConnection: { ownerId, tenantId },
        }),
      )
      .mockResolvedValueOnce(
        record({
          status: 'PENDING_TENANT_APPROVAL',
          tenantReviewStatus: 'REVIEW_CONFIRMED',
        }),
      );
    prisma.identityVerification.findUnique
      .mockResolvedValueOnce({ nationalId: null, status: 'APPROVED' })
      .mockResolvedValueOnce({ nationalId: null, status: 'APPROVED' });
    storage.upload.mockResolvedValue({ objectKey: 'contracts/final.pdf' });
    prisma.leaseContract.update.mockResolvedValue(
      record({
        status: 'APPROVED',
        tenantReviewStatus: 'REVIEW_CONFIRMED',
        pdfUrl: 'contracts/final.pdf',
      }),
    );

    await expect(
      service.confirmReview(tenantId, '55555555-5555-5555-5555-555555555555', {
        expectedRevision: 1,
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 'generated' }));
    expect(prisma.leaseContract.updateMany).toHaveBeenCalledWith({
      where: {
        id: '55555555-5555-5555-5555-555555555555',
        status: { not: 'APPROVED' },
      },
      data: { status: 'PENDING_TENANT_APPROVAL' },
    });
  });

  it('delivers a persisted review notification to the tenant when the owner sends the contract', async () => {
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({ status: 'DRAFTING' }),
    );
    prisma.leaseContract.update.mockResolvedValue(
      record({ status: 'PENDING_TENANT_APPROVAL' }),
    );

    await service.sendForReview(ownerId, matchId);

    expect(realtime.notifyUser).toHaveBeenCalledWith(tenantId, {
      type: 'CONTRACT_READY_FOR_REVIEW',
      title: expect.any(String),
      message: expect.any(String),
      link: `/contracts/new?matchConnectionId=${matchId}`,
    });
  });

  it('does not change property availability when the contract is approved', async () => {
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({ status: 'PENDING_TENANT_APPROVAL' }),
    );
    prisma.identityVerification.findUnique
      .mockResolvedValueOnce({
        nationalId: '29901010112345',
        status: 'APPROVED',
      })
      .mockResolvedValueOnce({
        nationalId: '30001010112345',
        status: 'APPROVED',
      });
    storage.upload.mockResolvedValue({ objectKey: 'contracts/final.pdf' });

    await service.approve(tenantId, matchId);

    expect(prisma).not.toHaveProperty('property');
  });

  it('completes the deal when both approved verifications omit legacy national IDs', async () => {
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({ status: 'PENDING_TENANT_APPROVAL' }),
    );
    prisma.identityVerification.findUnique
      .mockResolvedValueOnce({ nationalId: null, status: 'APPROVED' })
      .mockResolvedValueOnce({ nationalId: null, status: 'APPROVED' });
    storage.upload.mockResolvedValue({ objectKey: 'contracts/final.pdf' });

    await expect(service.approve(tenantId, matchId)).resolves.toEqual(
      expect.objectContaining({ status: 'generated' }),
    );
    expect(prisma.leaseContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED',
          ownerNationalId: null,
          tenantNationalId: null,
          tenantReviewStatus: 'REVIEW_CONFIRMED',
          tenantReviewedRevision: 1,
        }),
      }),
    );
    expect(prisma).not.toHaveProperty('property');
  });

  it('keeps repeated deal completion safe when the contract and property are already approved/archived', async () => {
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({ status: 'APPROVED' }),
    );

    await expect(service.approve(tenantId, matchId)).resolves.toEqual(
      expect.objectContaining({ status: 'generated' }),
    );
    expect(renderer.renderHtmlToPdf).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma).not.toHaveProperty('property');
  });
});
