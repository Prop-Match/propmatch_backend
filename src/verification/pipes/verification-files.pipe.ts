import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { IdentityImageValidator } from '../validation/identity-image.validator';
import {
  BufferedIdentityFile,
  ValidatedVerificationFiles,
  VerificationUploadFiles,
} from '../types/verification-upload-files.type';

const REQUIRED_FIELDS = [
  'nationalIdFront',
  'nationalIdBack',
  'selfie',
] as const;
type RequiredVerificationField = (typeof REQUIRED_FIELDS)[number];

const MISSING_FIELD_MESSAGES: Record<(typeof REQUIRED_FIELDS)[number], string> =
  {
    nationalIdFront: 'يجب إرفاق صورة الوجه الأمامي للبطاقة.',
    nationalIdBack: 'يجب إرفاق صورة الوجه الخلفي للبطاقة.',
    selfie: 'يجب إرفاق صورة شخصية.',
  };

@Injectable()
export class VerificationFilesPipe implements PipeTransform<
  VerificationUploadFiles | undefined,
  ValidatedVerificationFiles
> {
  constructor(private readonly imageValidator: IdentityImageValidator) {}

  transform(
    files: VerificationUploadFiles | undefined,
  ): ValidatedVerificationFiles {
    const receivedFiles = files ?? {};
    const fieldNames = Object.keys(receivedFiles);
    if (
      fieldNames.some(
        (fieldName) => !REQUIRED_FIELDS.includes(fieldName as never),
      )
    ) {
      throw new BadRequestException('عدد الملفات المرفوعة غير صحيح.');
    }

    for (const fieldName of REQUIRED_FIELDS) {
      const fieldFiles = receivedFiles[fieldName];
      if (!fieldFiles || fieldFiles.length === 0) {
        throw new BadRequestException(MISSING_FIELD_MESSAGES[fieldName]);
      }
      if (fieldFiles.length !== 1) {
        throw new BadRequestException('عدد الملفات المرفوعة غير صحيح.');
      }
    }

    const totalFiles = Object.values(receivedFiles).flat().length;
    if (totalFiles !== 3) {
      throw new BadRequestException('عدد الملفات المرفوعة غير صحيح.');
    }

    return {
      nationalIdFront: this.validateField(
        'nationalIdFront',
        receivedFiles.nationalIdFront![0],
      ),
      nationalIdBack: this.validateField(
        'nationalIdBack',
        receivedFiles.nationalIdBack![0],
      ),
      selfie: this.validateField('selfie', receivedFiles.selfie![0]),
    };
  }

  private validateField(
    expectedFieldName: RequiredVerificationField,
    file: BufferedIdentityFile,
  ): BufferedIdentityFile {
    const validatedFile = this.imageValidator.validate(file);
    if (validatedFile.fieldname !== expectedFieldName) {
      throw new BadRequestException('بيانات الصورة غير صالحة.');
    }

    return validatedFile;
  }
}
