import { NotImplementedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { validate } from 'class-validator';
import { VerificationStatus } from 'generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { VerificationService } from './verification.service';

const safeSelect = {
  status: true,
  rejectionReason: true,
  submittedAt: true,
  reviewedAt: true,
};

describe('VerificationService', () => {
  const findUnique = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const upsert = jest.fn();
  const prisma = {
    identityVerification: { findUnique, create, update, upsert },
  };
  let service: VerificationService;

  const date = new Date('2026-07-18T10:00:00.000Z');
  const selectedRow = (
    status: VerificationStatus,
    rejectionReason: string | null = null,
  ) => ({ status, rejectionReason, submittedAt: date, reviewedAt: null });

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(VerificationService);
  });

  it('maps no row to a submittable NOT_SUBMITTED response', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.getMyVerification('user-1')).resolves.toEqual({
      status: 'NOT_SUBMITTED',
      rejectionReason: null,
      submittedAt: null,
      reviewedAt: null,
      canSubmit: true,
    });
  });

  it.each([
    ['PENDING', false],
    ['APPROVED', false],
  ] as const)('%s cannot be submitted again', async (status, canSubmit) => {
    findUnique.mockResolvedValue(selectedRow(status, 'stale reason'));

    const response = await service.getMyVerification('user-1');

    expect(response.canSubmit).toBe(canSubmit);
    expect(response.rejectionReason).toBeNull();
  });

  it('returns a rejection reason for REJECTED without allowing submission', async () => {
    findUnique.mockResolvedValue(selectedRow('REJECTED', 'سبب الرفض'));

    await expect(service.getMyVerification('user-1')).resolves.toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'سبب الرفض',
      canSubmit: false,
    });
  });

  it('returns a rejection reason for RESUBMISSION_REQUIRED and allows submission', async () => {
    findUnique.mockResolvedValue(
      selectedRow('RESUBMISSION_REQUIRED', 'يرجى إعادة الرفع'),
    );

    await expect(service.getMyVerification('user-1')).resolves.toMatchObject({
      status: 'RESUBMISSION_REQUIRED',
      rejectionReason: 'يرجى إعادة الرفع',
      canSubmit: true,
    });
  });

  it('uses the exact safe Prisma select and never returns sensitive fields', async () => {
    findUnique.mockResolvedValue(selectedRow('PENDING'));

    const response = await service.getMyVerification('user-1');

    expect(findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: safeSelect,
    });
    expect(response).not.toHaveProperty('nationalId');
    expect(response).not.toHaveProperty('nationalIdFrontObjectKey');
    expect(response).not.toHaveProperty('nationalIdBackObjectKey');
    expect(response).not.toHaveProperty('selfieObjectKey');
    expect(response).not.toHaveProperty('id');
    expect(response).not.toHaveProperty('userId');
    expect(response).not.toHaveProperty('reviewedBy');
  });

  it('keeps submit as a non-persisting Not Implemented stub', async () => {
    await expect(service.submit('user-1', {})).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('SubmitVerificationDto', () => {
  const validateNationalId = (nationalId: unknown) => {
    const dto = new SubmitVerificationDto();
    dto.nationalId = nationalId as string | undefined;
    return validate(dto);
  };

  it('accepts an omitted nationalId', async () => {
    await expect(validate(new SubmitVerificationDto())).resolves.toHaveLength(
      0,
    );
  });

  it('accepts an explicitly undefined nationalId', async () => {
    await expect(validateNationalId(undefined)).resolves.toHaveLength(0);
  });

  it.each(['valid-national-id', '123'])(
    'accepts a non-empty nationalId without finalizing its format: %s',
    async (nationalId) => {
      await expect(validateNationalId(nationalId)).resolves.toHaveLength(0);
    },
  );

  it('rejects null nationalId', async () => {
    await expect(validateNationalId(null)).resolves.not.toHaveLength(0);
  });

  it.each(['', '   '])(
    'rejects %p with exactly one required-message constraint',
    async (nationalId) => {
      const errors = await validateNationalId(nationalId);
      const messages = errors.flatMap((error) =>
        Object.values(error.constraints ?? {}),
      );
      const requiredMessages = messages.filter((message) =>
        message.includes('validation.REQUIRED'),
      );

      expect(errors).not.toHaveLength(0);
      expect(requiredMessages).toHaveLength(1);
    },
  );
});
