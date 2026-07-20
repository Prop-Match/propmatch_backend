/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { VerificationDocumentUploadService } from './services/verification-document-upload.service';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { ValidatedVerificationFiles } from './types/verification-upload-files.type';
import { VerificationService } from './verification.service';

const files: ValidatedVerificationFiles = {
  nationalIdFront: {
    fieldname: 'nationalIdFront',
    mimetype: 'image/jpeg',
    size: 3,
    buffer: Buffer.from([0xff, 0xd8, 0xff]),
  },
  nationalIdBack: {
    fieldname: 'nationalIdBack',
    mimetype: 'image/jpeg',
    size: 3,
    buffer: Buffer.from([0xff, 0xd8, 0xff]),
  },
  selfie: {
    fieldname: 'selfie',
    mimetype: 'image/jpeg',
    size: 3,
    buffer: Buffer.from([0xff, 0xd8, 0xff]),
  },
};
const newKeys = {
  nationalIdFrontObjectKey: 'new-front',
  nationalIdBackObjectKey: 'new-back',
  selfieObjectKey: 'new-selfie',
};
const oldKeys = {
  nationalIdFrontObjectKey: 'old-front',
  nationalIdBackObjectKey: 'old-back',
  selfieObjectKey: 'old-selfie',
};
const databaseOldKeys = {
  nationalIdFrontUrl: 'old-front',
  nationalIdBackUrl: 'old-back',
  selfieUrl: 'old-selfie',
};
const databaseNewKeys = {
  nationalIdFrontUrl: 'new-front',
  nationalIdBackUrl: 'new-back',
  selfieUrl: 'new-selfie',
};

describe('VerificationService submission lifecycle', () => {
  const findUser = jest.fn();
  const findVerification = jest.fn();
  const createVerification = jest.fn();
  const updateManyVerification = jest.fn();
  const uploadVerificationDocuments = jest.fn();
  const deleteVerificationDocuments = jest.fn();
  const kycSubmitted = jest.fn();
  const prisma = {
    user: { findUnique: findUser },
    identityVerification: {
      findUnique: findVerification,
      create: createVerification,
      updateMany: updateManyVerification,
    },
  };
  const uploads = { uploadVerificationDocuments, deleteVerificationDocuments };
  const realtime = { kycSubmitted };
  const service = new VerificationService(
    prisma as unknown as PrismaService,
    uploads as unknown as VerificationDocumentUploadService,
    realtime as unknown as RealtimeService,
  );
  const noVerificationUser = {
    fullName: 'Test User',
    identityVerification: null,
  };
  const resubmissionUser = {
    fullName: 'Test User',
    identityVerification: { status: 'RESUBMISSION_REQUIRED', ...databaseOldKeys },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    uploadVerificationDocuments.mockResolvedValue(newKeys);
    deleteVerificationDocuments.mockResolvedValue(undefined);
    createVerification.mockResolvedValue({});
    updateManyVerification.mockResolvedValue({ count: 1 });
  });

  it.each([
    ['PENDING', 'طلب التحقق قيد المراجعة بالفعل.'],
    ['APPROVED', 'تم توثيق الهوية بالفعل.'],
    ['REJECTED', 'لا يمكن إعادة إرسال طلب التحقق في حالته الحالية.'],
  ])('rejects %s before upload', async (status, message) => {
    findUser.mockResolvedValue({
      fullName: 'Test User',
      identityVerification: { status, ...oldKeys },
    });
    await expect(service.submit('user-1', {}, files)).rejects.toMatchObject({
      message,
    });
    expect(uploadVerificationDocuments).not.toHaveBeenCalled();
    expect(createVerification).not.toHaveBeenCalled();
    expect(updateManyVerification).not.toHaveBeenCalled();
    expect(deleteVerificationDocuments).not.toHaveBeenCalled();
    expect(kycSubmitted).not.toHaveBeenCalled();
  });

  it('rejects a missing authenticated user without side effects', async () => {
    findUser.mockResolvedValue(null);
    await expect(service.submit('user-1', {}, files)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(uploadVerificationDocuments).not.toHaveBeenCalled();
    expect(createVerification).not.toHaveBeenCalled();
    expect(kycSubmitted).not.toHaveBeenCalled();
  });

  it.each([['provided-id'], [undefined]])(
    'creates a pending verification safely',
    async (nationalId) => {
      findUser.mockResolvedValue(noVerificationUser);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const id = nationalId as string | undefined;
      const response = await service.submit(
        'user-1',
        { nationalId: id },
        files,
      );
      expect(uploadVerificationDocuments).toHaveBeenCalledWith(files);
      expect(createVerification).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            nationalId: id ?? null,
            ...databaseNewKeys,
            status: 'PENDING',
            rejectionReason: null,
            reviewedAt: null,
            reviewedBy: null,
          }),
        }),
      );
      expect(kycSubmitted).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', userName: 'Test User' }),
      );
      expect(response).toMatchObject({
        status: 'PENDING',
        rejectionReason: null,
        reviewedAt: null,
        canSubmit: false,
      });
      expect(response).not.toHaveProperty('nationalIdFrontUrl');
    },
  );

  it('preserves upload errors without persistence or announcement', async () => {
    const error = new Error('upload failed');
    findUser.mockResolvedValue(noVerificationUser);
    uploadVerificationDocuments.mockRejectedValue(error);
    await expect(service.submit('user-1', {}, files)).rejects.toBe(error);
    expect(createVerification).not.toHaveBeenCalled();
    expect(deleteVerificationDocuments).not.toHaveBeenCalled();
    expect(kycSubmitted).not.toHaveBeenCalled();
  });

  it.each([
    [new Error('database failed')],
    [Object.assign(new Error('unique'), { code: 'P2002' })],
  ])('cleans new objects after create failure', async (error) => {
    findUser.mockResolvedValue(noVerificationUser);
    createVerification.mockRejectedValue(error);
    await expect(service.submit('user-1', {}, files)).rejects.toBeInstanceOf(
      error instanceof Error && 'code' in error ? ConflictException : Error,
    );
    expect(deleteVerificationDocuments).toHaveBeenCalledWith(newKeys);
    expect(kycSubmitted).not.toHaveBeenCalled();
  });

  it.each([
    ['provided-id', true],
    [undefined, false],
  ])(
    'conditionally updates allowed resubmission national ID',
    async (nationalId, hasNationalId) => {
      findUser.mockResolvedValue(resubmissionUser);
      await service.submit('user-1', { nationalId }, files);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const update = updateManyVerification.mock.calls[0]?.[0] as unknown as {
        where: { userId: string; status: string };
        data: Record<string, unknown>;
      };
      expect(update.where).toEqual({
        userId: 'user-1',
        status: 'RESUBMISSION_REQUIRED',
      });
      expect(update.data).toMatchObject({
        ...databaseNewKeys,
        status: 'PENDING',
        rejectionReason: null,
        reviewedAt: null,
        reviewedBy: null,
      });
      if (hasNationalId) expect(update.data.nationalId).toBe(nationalId);
      else expect(update.data).not.toHaveProperty('nationalId');
      expect(deleteVerificationDocuments).toHaveBeenCalledWith(oldKeys);
      expect(kycSubmitted).toHaveBeenCalledTimes(1);
    },
  );

  it.each([[{ count: 0 }], [new Error('update failed')]])(
    'cleans new keys but retains old keys when resubmission cannot persist',
    async (result) => {
      findUser.mockResolvedValue(resubmissionUser);
      if ('count' in result) updateManyVerification.mockResolvedValue(result);
      else updateManyVerification.mockRejectedValue(result);
      await expect(service.submit('user-1', {}, files)).rejects.toBeInstanceOf(
        'count' in result ? ConflictException : Error,
      );
      expect(deleteVerificationDocuments).toHaveBeenCalledTimes(1);
      expect(deleteVerificationDocuments).toHaveBeenCalledWith(newKeys);
      expect(deleteVerificationDocuments).not.toHaveBeenCalledWith(oldKeys);
      expect(kycSubmitted).not.toHaveBeenCalled();
    },
  );

  it('keeps persisted submission successful if realtime fails', async () => {
    findUser.mockResolvedValue(noVerificationUser);
    kycSubmitted.mockImplementation(() => {
      throw new Error('socket unavailable');
    });
    await expect(service.submit('user-1', {}, files)).resolves.toMatchObject({
      status: 'PENDING',
    });
    expect(createVerification).toHaveBeenCalled();
    expect(deleteVerificationDocuments).not.toHaveBeenCalled();
  });

  it.each([
    [
      null,
      {
        status: 'NOT_SUBMITTED',
        rejectionReason: null,
        submittedAt: null,
        reviewedAt: null,
        canSubmit: true,
      },
    ],
    [
      {
        status: 'PENDING',
        rejectionReason: 'hidden',
        submittedAt: new Date(),
        reviewedAt: null,
      },
      { canSubmit: false, rejectionReason: null },
    ],
    [
      {
        status: 'APPROVED',
        rejectionReason: 'hidden',
        submittedAt: new Date(),
        reviewedAt: null,
      },
      { canSubmit: false, rejectionReason: null },
    ],
    [
      {
        status: 'REJECTED',
        rejectionReason: 'reason',
        submittedAt: new Date(),
        reviewedAt: null,
      },
      { canSubmit: false, rejectionReason: 'reason' },
    ],
    [
      {
        status: 'RESUBMISSION_REQUIRED',
        rejectionReason: 'reason',
        submittedAt: new Date(),
        reviewedAt: null,
      },
      { canSubmit: true, rejectionReason: 'reason' },
    ],
  ])('keeps GET verification response safe', async (row, expected) => {
    findVerification.mockResolvedValue(row);
    const response = await service.getMyVerification('user-1');
    expect(response).toMatchObject(expected);
    expect(findVerification).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: {
        status: true,
        rejectionReason: true,
        submittedAt: true,
        reviewedAt: true,
      },
    });
    for (const key of [
      'id',
      'userId',
      'nationalId',
      'reviewedBy',
      'nationalIdFrontUrl',
      'nationalIdBackUrl',
      'selfieUrl',
    ])
      expect(response).not.toHaveProperty(key);
  });
});

describe('SubmitVerificationDto', () => {
  const validateNationalId = (nationalId: unknown) => {
    const dto = new SubmitVerificationDto();
    dto.nationalId = nationalId as string | undefined;
    return validate(dto);
  };
  it('accepts omitted, undefined, and non-empty national IDs', async () => {
    await expect(validate(new SubmitVerificationDto())).resolves.toHaveLength(
      0,
    );
    await expect(validateNationalId(undefined)).resolves.toHaveLength(0);
    await expect(validateNationalId('123')).resolves.toHaveLength(0);
  });
  it.each([null, '', '   '])(
    'rejects invalid national ID value %p',
    async (value) => {
      const errors = await validateNationalId(value);
      expect(errors).not.toHaveLength(0);
      if (typeof value === 'string') {
        const messages = errors.flatMap((error) =>
          Object.values(error.constraints ?? {}),
        );
        expect(
          messages.filter((message) => message.includes('validation.REQUIRED')),
        ).toHaveLength(1);
      }
    },
  );
});
