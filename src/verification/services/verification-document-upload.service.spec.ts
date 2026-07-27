import { PrivateObjectStorage } from '../../storage/private-object-storage.interface';
import { ValidatedVerificationFiles } from '../types/verification-upload-files.type';
import { VerificationDocumentUploadService } from './verification-document-upload.service';
import { IdentityImageValidator } from '../validation/identity-image.validator';

const files: ValidatedVerificationFiles = {
  nationalIdFront: {
    fieldname: 'nationalIdFront',
    mimetype: 'image/jpeg',
    size: 3,
    buffer: Buffer.from([0xff, 0xd8, 0xff]),
  },
  nationalIdBack: {
    fieldname: 'nationalIdBack',
    mimetype: 'image/png',
    size: 8,
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  selfie: {
    fieldname: 'selfie',
    mimetype: 'image/webp',
    size: 12,
    buffer: Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP'),
    ]),
  },
};

describe('VerificationDocumentUploadService', () => {
  const upload = jest.fn();
  const remove = jest.fn();
  const storage: jest.Mocked<PrivateObjectStorage> = {
    upload,
    createTemporaryReadUrl: jest.fn(),
    readTemporaryObject: jest.fn(),
    delete: remove,
  };
  let service: VerificationDocumentUploadService;
  let identityImageValidator: IdentityImageValidator;

  beforeEach(() => {
    jest.clearAllMocks();
    identityImageValidator = new IdentityImageValidator();
    service = new VerificationDocumentUploadService(
      storage,
      identityImageValidator,
    );
  });

  it('uploads validated documents in deterministic order with only storage-safe inputs', async () => {
    upload
      .mockResolvedValueOnce({ objectKey: 'front-key' })
      .mockResolvedValueOnce({ objectKey: 'back-key' })
      .mockResolvedValueOnce({ objectKey: 'selfie-key' });

    await expect(service.uploadVerificationDocuments(files)).resolves.toEqual({
      nationalIdFrontObjectKey: 'front-key',
      nationalIdBackObjectKey: 'back-key',
      selfieObjectKey: 'selfie-key',
    });
    expect(upload.mock.calls).toEqual([
      [{ data: files.nationalIdFront.buffer, contentType: 'image/jpeg' }],
      [{ data: files.nationalIdBack.buffer, contentType: 'image/png' }],
      [{ data: files.selfie.buffer, contentType: 'image/webp' }],
    ]);
    expect(remove).not.toHaveBeenCalled();
  });

  it('validates every file before the first storage upload', async () => {
    const validate = jest.spyOn(identityImageValidator, 'validate');
    upload.mockImplementationOnce(() => {
      expect(validate).toHaveBeenCalledTimes(3);
      return Promise.resolve({ objectKey: 'front-key' });
    });
    upload
      .mockResolvedValueOnce({ objectKey: 'back-key' })
      .mockResolvedValueOnce({ objectKey: 'selfie-key' });

    await service.uploadVerificationDocuments(files);
    expect(validate).toHaveBeenCalledTimes(3);
  });

  it.each([['nationalIdFront'], ['nationalIdBack'], ['selfie']] as const)(
    'does not upload when %s has an invalid signature',
    async (field) => {
      const invalidFiles = {
        ...files,
        [field]: {
          ...files[field],
          size: 2,
          buffer: Buffer.from('MZ'),
        },
      };

      await expect(
        service.uploadVerificationDocuments(invalidFiles),
      ).rejects.toThrow();
      expect(upload).not.toHaveBeenCalled();
    },
  );

  it('does not upload when a declared MIME type does not match its signature', async () => {
    const invalidFiles = {
      ...files,
      nationalIdBack: {
        ...files.nationalIdBack,
        mimetype: 'image/jpeg',
      },
    };

    await expect(
      service.uploadVerificationDocuments(invalidFiles),
    ).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });

  it('does not upload malformed runtime files', async () => {
    const malformedFiles = {
      ...files,
      selfie: {
        ...files.selfie,
        buffer: undefined,
      },
    } as unknown as ValidatedVerificationFiles;

    await expect(
      service.uploadVerificationDocuments(malformedFiles),
    ).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });

  it('does not delete when the first upload fails', async () => {
    const uploadError = new Error('upload failed');
    upload.mockRejectedValueOnce(uploadError);

    await expect(service.uploadVerificationDocuments(files)).rejects.toBe(
      uploadError,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('rolls back earlier uploads in reverse order without replacing the upload error', async () => {
    const secondUploadError = new Error('second upload failed');
    upload
      .mockResolvedValueOnce({ objectKey: 'front-key' })
      .mockRejectedValueOnce(secondUploadError);

    await expect(service.uploadVerificationDocuments(files)).rejects.toBe(
      secondUploadError,
    );
    expect(remove).toHaveBeenCalledWith('front-key');

    jest.clearAllMocks();
    const thirdUploadError = new Error('third upload failed');
    upload
      .mockResolvedValueOnce({ objectKey: 'front-key' })
      .mockResolvedValueOnce({ objectKey: 'back-key' })
      .mockRejectedValueOnce(thirdUploadError);
    remove.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(service.uploadVerificationDocuments(files)).rejects.toBe(
      thirdUploadError,
    );
    expect(remove.mock.calls).toEqual([['back-key'], ['front-key']]);
  });

  it('does not log during uploads or rollback', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation();
    upload
      .mockResolvedValueOnce({ objectKey: 'front-key' })
      .mockResolvedValueOnce({ objectKey: 'back-key' })
      .mockResolvedValueOnce({ objectKey: 'selfie-key' });

    try {
      await service.uploadVerificationDocuments(files);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('deletes documents in reverse order and continues after failures', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation();
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const error = jest.spyOn(console, 'error').mockImplementation();
    remove.mockRejectedValueOnce(new Error('selfie cleanup failed'));

    try {
      await expect(
        service.deleteVerificationDocuments({
          nationalIdFrontObjectKey: 'front-key',
          nationalIdBackObjectKey: 'back-key',
          selfieObjectKey: 'selfie-key',
        }),
      ).resolves.toBeUndefined();
      expect(remove.mock.calls).toEqual([
        ['selfie-key'],
        ['back-key'],
        ['front-key'],
      ]);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('continues cleanup when the middle deletion fails', async () => {
    remove
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('back failed'))
      .mockResolvedValueOnce(undefined);
    await expect(
      service.deleteVerificationDocuments({
        nationalIdFrontObjectKey: 'front-key',
        nationalIdBackObjectKey: 'back-key',
        selfieObjectKey: 'selfie-key',
      }),
    ).resolves.toBeUndefined();
    expect(remove.mock.calls).toEqual([
      ['selfie-key'],
      ['back-key'],
      ['front-key'],
    ]);
  });
});
