import { BadRequestException } from '@nestjs/common';
import {
  BufferedIdentityFile,
  VerificationUploadFiles,
} from '../types/verification-upload-files.type';
import { VerificationFilesPipe } from './verification-files.pipe';
import { IdentityImageValidator } from '../validation/identity-image.validator';

const image = (fieldname: string): BufferedIdentityFile => ({
  fieldname,
  mimetype: 'image/jpeg',
  size: 3,
  buffer: Buffer.from([0xff, 0xd8, 0xff]),
});

const validFiles = (): VerificationUploadFiles => ({
  nationalIdFront: [image('nationalIdFront')],
  nationalIdBack: [image('nationalIdBack')],
  selfie: [image('selfie')],
});

describe('VerificationFilesPipe', () => {
  const pipe = new VerificationFilesPipe(new IdentityImageValidator());

  it('accepts exactly one valid file for every required field without original names', () => {
    const files = validFiles() as VerificationUploadFiles & {
      nationalIdFront: Array<BufferedIdentityFile & { originalname: string }>;
    };
    files.nationalIdFront[0].originalname = 'identity.png';

    const result = pipe.transform(files);

    expect(result).toEqual({
      nationalIdFront: image('nationalIdFront'),
      nationalIdBack: image('nationalIdBack'),
      selfie: image('selfie'),
    });
    expect(result.nationalIdFront).not.toHaveProperty('originalname');
  });

  it.each([['nationalIdFront'], ['nationalIdBack'], ['selfie']] as const)(
    'rejects a missing %s file',
    (field) => {
      const files = validFiles();
      delete files[field];
      expect(() => pipe.transform(files)).toThrow(BadRequestException);
    },
  );

  it('rejects duplicate, unknown, and incorrect total file collections', () => {
    const duplicate = validFiles();
    duplicate.nationalIdFront?.push(image('nationalIdFront'));
    expect(() => pipe.transform(duplicate)).toThrow(BadRequestException);

    const unknown = {
      ...validFiles(),
      extra: [image('extra')],
    } as unknown as VerificationUploadFiles;
    expect(() => pipe.transform(unknown)).toThrow(BadRequestException);

    const incomplete = validFiles();
    incomplete.selfie = [];
    expect(() => pipe.transform(incomplete)).toThrow(BadRequestException);
  });

  it.each([
    ['nationalIdFront', 'selfie'],
    ['nationalIdBack', 'nationalIdFront'],
    ['selfie', ''],
  ] as const)(
    'rejects an incorrect internal field name for %s',
    (field, fieldname) => {
      const files = validFiles();
      files[field]![0] = image(fieldname);

      expect(() => pipe.transform(files)).toThrow(BadRequestException);
    },
  );
});
