import { Inject, Injectable } from '@nestjs/common';
import type { PrivateObjectStorage } from '../../storage/private-object-storage.interface';
import { PRIVATE_OBJECT_STORAGE } from '../../storage/private-object-storage.token';
import { ValidatedVerificationFiles } from '../types/verification-upload-files.type';
import { IdentityImageValidator } from '../validation/identity-image.validator';

export type UploadedVerificationDocumentKeys = {
  nationalIdFrontObjectKey: string;
  nationalIdBackObjectKey: string;
  selfieObjectKey: string;
};

@Injectable()
export class VerificationDocumentUploadService {
  constructor(
    @Inject(PRIVATE_OBJECT_STORAGE)
    private readonly privateObjectStorage: PrivateObjectStorage,
    private readonly identityImageValidator: IdentityImageValidator,
  ) {}

  async uploadVerificationDocuments(
    files: ValidatedVerificationFiles,
  ): Promise<UploadedVerificationDocumentKeys> {
    const validatedFiles = {
      nationalIdFront: this.identityImageValidator.validate(
        files.nationalIdFront,
      ),
      nationalIdBack: this.identityImageValidator.validate(
        files.nationalIdBack,
      ),
      selfie: this.identityImageValidator.validate(files.selfie),
    };
    const uploadedKeys: string[] = [];

    try {
      const nationalIdFront = await this.upload(
        validatedFiles.nationalIdFront,
        uploadedKeys,
      );
      const nationalIdBack = await this.upload(
        validatedFiles.nationalIdBack,
        uploadedKeys,
      );
      const selfie = await this.upload(validatedFiles.selfie, uploadedKeys);

      return {
        nationalIdFrontObjectKey: nationalIdFront,
        nationalIdBackObjectKey: nationalIdBack,
        selfieObjectKey: selfie,
      };
    } catch (error: unknown) {
      await this.rollback(uploadedKeys);
      throw error;
    }
  }

  private async upload(
    file: ValidatedVerificationFiles[keyof ValidatedVerificationFiles],
    uploadedKeys: string[],
  ): Promise<string> {
    const { objectKey } = await this.privateObjectStorage.upload({
      data: file.buffer,
      contentType: file.mimetype,
    });
    uploadedKeys.push(objectKey);
    return objectKey;
  }

  private async rollback(uploadedKeys: string[]): Promise<void> {
    for (const objectKey of [...uploadedKeys].reverse()) {
      try {
        await this.privateObjectStorage.delete(objectKey);
      } catch {
        // Preserve the original upload error; cleanup is best-effort.
      }
    }
  }
}
