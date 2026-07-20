import { BadRequestException, Injectable } from '@nestjs/common';
import { BufferedIdentityFile } from '../types/verification-upload-files.type';

export const MAX_IDENTITY_IMAGE_SIZE = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class IdentityImageValidator {
  validate(file: BufferedIdentityFile): BufferedIdentityFile {
    if (!this.isBufferedIdentityFile(file)) {
      throw new BadRequestException('بيانات الصورة غير صالحة.');
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('نوع الصورة غير مدعوم.');
    }

    if (file.size === 0 || file.buffer.length === 0) {
      throw new BadRequestException('الصورة فارغة.');
    }

    if (
      file.size !== file.buffer.length ||
      file.size > MAX_IDENTITY_IMAGE_SIZE ||
      file.buffer.length > MAX_IDENTITY_IMAGE_SIZE
    ) {
      throw new BadRequestException('حجم الصورة يتجاوز الحد المسموح.');
    }

    if (!this.signatureMatchesMimeType(file.buffer, file.mimetype)) {
      throw new BadRequestException('محتوى الصورة لا يطابق نوع الملف.');
    }

    return {
      fieldname: file.fieldname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    };
  }

  private isBufferedIdentityFile(file: unknown): file is BufferedIdentityFile {
    if (typeof file !== 'object' || file === null) {
      return false;
    }

    const candidate = file as Record<string, unknown>;
    return (
      Buffer.isBuffer(candidate.buffer) &&
      typeof candidate.mimetype === 'string' &&
      typeof candidate.fieldname === 'string' &&
      candidate.fieldname.trim().length > 0 &&
      typeof candidate.size === 'number' &&
      Number.isFinite(candidate.size) &&
      Number.isInteger(candidate.size) &&
      candidate.size >= 0
    );
  }

  private signatureMatchesMimeType(buffer: Buffer, mimetype: string): boolean {
    switch (mimetype) {
      case 'image/jpeg':
        return (
          buffer.length >= 3 &&
          buffer[0] === 0xff &&
          buffer[1] === 0xd8 &&
          buffer[2] === 0xff
        );
      case 'image/png':
        return buffer
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          );
      case 'image/webp':
        return (
          buffer.length >= 12 &&
          buffer.subarray(0, 4).equals(Buffer.from('RIFF')) &&
          buffer.subarray(8, 12).equals(Buffer.from('WEBP'))
        );
      default:
        return false;
    }
  }
}
