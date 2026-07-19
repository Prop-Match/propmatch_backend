import { Test } from '@nestjs/testing';
import { PRIVATE_OBJECT_STORAGE } from '../storage/private-object-storage.token';
import { VerificationFilesPipe } from './pipes/verification-files.pipe';
import { VerificationDocumentUploadService } from './services/verification-document-upload.service';
import { IdentityImageValidator } from './validation/identity-image.validator';

describe('Verification upload provider graph', () => {
  it('instantiates the validator, pipe, and upload coordinator through Nest DI', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IdentityImageValidator,
        VerificationFilesPipe,
        VerificationDocumentUploadService,
        {
          provide: PRIVATE_OBJECT_STORAGE,
          useValue: { upload: jest.fn(), delete: jest.fn() },
        },
      ],
    }).compile();

    expect(moduleRef.get(IdentityImageValidator)).toBeInstanceOf(
      IdentityImageValidator,
    );
    expect(moduleRef.get(VerificationFilesPipe)).toBeInstanceOf(
      VerificationFilesPipe,
    );
    expect(moduleRef.get(VerificationDocumentUploadService)).toBeInstanceOf(
      VerificationDocumentUploadService,
    );
  });

  it('fails to compile the pipe when its validator provider is omitted', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          VerificationFilesPipe,
          {
            provide: PRIVATE_OBJECT_STORAGE,
            useValue: { upload: jest.fn(), delete: jest.fn() },
          },
        ],
      }).compile(),
    ).rejects.toThrow('IdentityImageValidator');
  });
});
