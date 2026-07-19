import { BadRequestException } from '@nestjs/common';
import { BufferedIdentityFile } from '../types/verification-upload-files.type';
import {
  IdentityImageValidator,
  MAX_IDENTITY_IMAGE_SIZE,
} from './identity-image.validator';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
]);

describe('IdentityImageValidator', () => {
  const validator = new IdentityImageValidator();
  const file = (mimetype: string, buffer: Buffer): BufferedIdentityFile => ({
    fieldname: 'selfie',
    mimetype,
    size: buffer.length,
    buffer,
  });

  it.each([
    ['image/jpeg', jpeg],
    ['image/png', png],
    ['image/webp', webp],
  ])('accepts valid %s signatures', (mimetype, buffer) => {
    expect(validator.validate(file(mimetype, buffer))).toMatchObject({
      mimetype,
      buffer,
    });
  });

  it.each([
    ['empty', file('image/jpeg', Buffer.alloc(0))],
    ['executable disguised as JPEG', file('image/jpeg', Buffer.from('MZ'))],
    ['PNG declared as JPEG', file('image/jpeg', png)],
    ['JPEG declared as PNG', file('image/png', jpeg)],
    ['unsupported MIME', file('application/octet-stream', jpeg)],
    ['truncated JPEG', file('image/jpeg', Buffer.from([0xff, 0xd8]))],
    ['truncated PNG', file('image/png', png.subarray(0, 7))],
    ['truncated WebP', file('image/webp', webp.subarray(0, 11))],
  ])('rejects %s', (_name, invalidFile) => {
    expect(() => validator.validate(invalidFile)).toThrow(BadRequestException);
  });

  it.each([
    ['undefined', undefined],
    [
      'missing buffer',
      { fieldname: 'selfie', mimetype: 'image/jpeg', size: 3 },
    ],
    [
      'undefined buffer',
      {
        fieldname: 'selfie',
        mimetype: 'image/jpeg',
        size: 3,
        buffer: undefined,
      },
    ],
    [
      'plain object buffer',
      { fieldname: 'selfie', mimetype: 'image/jpeg', size: 3, buffer: {} },
    ],
    [
      'string buffer',
      { fieldname: 'selfie', mimetype: 'image/jpeg', size: 3, buffer: 'jpeg' },
    ],
    ['missing MIME type', { fieldname: 'selfie', size: 3, buffer: jpeg }],
    ['missing field name', { mimetype: 'image/jpeg', size: 3, buffer: jpeg }],
    [
      'negative size',
      { fieldname: 'selfie', mimetype: 'image/jpeg', size: -1, buffer: jpeg },
    ],
    [
      'non-integer size',
      { fieldname: 'selfie', mimetype: 'image/jpeg', size: 1.5, buffer: jpeg },
    ],
    [
      'NaN size',
      {
        fieldname: 'selfie',
        mimetype: 'image/jpeg',
        size: Number.NaN,
        buffer: jpeg,
      },
    ],
    [
      'mismatched size',
      { fieldname: 'selfie', mimetype: 'image/jpeg', size: 3, buffer: jpeg },
    ],
  ])(
    'rejects malformed runtime input: %s without a TypeError',
    (_name, value) => {
      expect(() =>
        validator.validate(value as unknown as BufferedIdentityFile),
      ).toThrow(BadRequestException);
      expect(() =>
        validator.validate(value as unknown as BufferedIdentityFile),
      ).not.toThrow(TypeError);
    },
  );

  it('rejects a file larger than 5 MiB', () => {
    const oversized = Buffer.alloc(MAX_IDENTITY_IMAGE_SIZE + 1);
    jpeg.copy(oversized);
    expect(() => validator.validate(file('image/jpeg', oversized))).toThrow(
      BadRequestException,
    );
  });

  it('accepts an otherwise valid file exactly 5 MiB', () => {
    const maximumSize = Buffer.alloc(MAX_IDENTITY_IMAGE_SIZE);
    jpeg.copy(maximumSize);
    expect(validator.validate(file('image/jpeg', maximumSize))).toMatchObject({
      size: MAX_IDENTITY_IMAGE_SIZE,
    });
  });
});
