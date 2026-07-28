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

const ownerId = '11111111-1111-1111-1111-111111111111';
const tenantId = '22222222-2222-2222-2222-222222222222';
const otherId = '33333333-3333-3333-3333-333333333333';
const matchId = '44444444-4444-4444-4444-444444444444';

describe('LeaseContractsService draft API', () => {
  let service: LeaseContractsService;
  let prisma: any;
  let storage: { upload: jest.Mock; createTemporaryReadUrl: jest.Mock };
  let renderer: { renderHtmlToPdf: jest.Mock };

  const match = {
    id: matchId,
    status: 'CONNECTED',
    ownerId,
    tenantId,
    owner: { fullName: 'Owner Name' },
    tenant: { fullName: 'Tenant Name' },
    property: { district: 'Maadi', manualAddress: '12 Street', rentAmount: 12000 },
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
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      matchConnection: { findFirst: jest.fn().mockResolvedValue(match) },
      leaseContract: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(record()),
      },
      identityVerification: { findUnique: jest.fn() },
    };
    storage = { upload: jest.fn(), createTemporaryReadUrl: jest.fn() };
    renderer = { renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')) };
    const module = await Test.createTestingModule({
      providers: [
        LeaseContractsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PdfRendererService, useValue: renderer },
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
    expect(prisma.leaseContract.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
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

  it.each([0, -1, Number.NaN])('rejects non-positive or non-finite rent %p', async (rentAmount) => {
    await expect(service.saveDraft(ownerId, matchId, { ...validDraft(), rentAmount }))
      .rejects.toThrow(BadRequestException);
  });

  it.each([
    ['2026-02-30', '2027-07-31'],
    ['2026-08-01', '2027-02-30'],
    ['2026-08-01', '2026-08-01'],
    ['2026-08-02', '2026-08-01'],
  ])('rejects invalid or non-forward date ranges', async (startDate, endDate) => {
    await expect(service.saveDraft(ownerId, matchId, { ...validDraft(), startDate, endDate }))
      .rejects.toThrow(BadRequestException);
  });

  it('rejects empty and overlong custom clauses', async () => {
    await expect(service.saveDraft(ownerId, matchId, { ...validDraft(), customClauses: ['   '] }))
      .rejects.toThrow(BadRequestException);
    await expect(service.saveDraft(ownerId, matchId, { ...validDraft(), customClauses: ['x'.repeat(2001)] }))
      .rejects.toThrow(BadRequestException);
  });

  it('does not let the tenant or an unrelated user create the landlord draft', async () => {
    await expect(service.saveDraft(tenantId, matchId, validDraft())).rejects.toThrow(ForbiddenException);
    prisma.matchConnection.findFirst.mockResolvedValueOnce(null);
    await expect(service.saveDraft(otherId, matchId, validDraft())).rejects.toThrow();
  });

  it('permits only a party to read a contract and never serializes KYC fields', async () => {
    prisma.leaseContract.findUnique.mockResolvedValue(
      record({ matchConnection: { ownerId, tenantId } }),
    );
    const response = await service.getById(tenantId, '55555555-5555-5555-5555-555555555555');
    expect(response.ownerName).toBe('Owner Name');
    expect(response).not.toHaveProperty('ownerNationalId');
    expect(response).not.toHaveProperty('tenantNationalId');

    await expect(service.getById(otherId, '55555555-5555-5555-5555-555555555555'))
      .rejects.toThrow(ForbiddenException);
  });

  it('allows either party to generate an in-memory PDF only from a saved DRAFTING contract', async () => {
    prisma.leaseContract.findUnique.mockResolvedValue(record({ matchConnection: { ownerId, tenantId } }));
    await expect(service.downloadDraftPdf(ownerId, '55555555-5555-5555-5555-555555555555')).resolves.toEqual(Buffer.from('%PDF-test'));
    await expect(service.downloadDraftPdf(tenantId, '55555555-5555-5555-5555-555555555555')).resolves.toEqual(Buffer.from('%PDF-test'));
    expect(renderer.renderHtmlToPdf).toHaveBeenCalledWith(expect.stringContaining('Owner Name'));
    expect(prisma.leaseContract.upsert).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects unrelated readers and non-draft PDF requests', async () => {
    prisma.leaseContract.findUnique.mockResolvedValue(record({ matchConnection: { ownerId, tenantId } }));
    await expect(service.downloadDraftPdf(otherId, '55555555-5555-5555-5555-555555555555')).rejects.toThrow(ForbiddenException);
    prisma.leaseContract.findUnique.mockResolvedValue(record({ status: 'PENDING_TENANT_APPROVAL', matchConnection: { ownerId, tenantId } }));
    await expect(service.downloadDraftPdf(ownerId, '55555555-5555-5555-5555-555555555555')).rejects.toThrow(ConflictException);
  });
});
