import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export const MAX_PROPERTY_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_PROPERTY_IMAGES = 10;
export const PROPERTY_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Injectable()
export class PropertyImageStorageService {
  private readonly publicRoot = path.resolve(process.cwd(), 'public');
  private readonly propertyRoot = path.join(this.publicRoot, 'properties');

  async uploadMany(
    files: Express.Multer.File[] | undefined,
  ): Promise<string[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('أضف صورة واحدة على الأقل');
    }
    if (files.length > MAX_PROPERTY_IMAGES) {
      throw new BadRequestException('يمكنك إضافة 10 صور كحد أقصى');
    }

    for (const file of files) this.validate(file);
    await mkdir(this.propertyRoot, { recursive: true });

    const uploadedUrls: string[] = [];
    try {
      for (const file of files) {
        const filename = `${randomUUID()}${this.extensionFor(file.mimetype)}`;
        await writeFile(path.join(this.propertyRoot, filename), file.buffer, {
          flag: 'wx',
        });
        uploadedUrls.push(`/public/properties/${filename}`);
      }
      return uploadedUrls;
    } catch (error) {
      await this.deleteMany(uploadedUrls);
      throw error;
    }
  }

  async deleteMany(imageUrls: string[]): Promise<void> {
    for (const imageUrl of [...imageUrls].reverse()) {
      const filename = imageUrl.replace('/public/properties/', '');
      if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename)) continue;
      try {
        await unlink(path.join(this.propertyRoot, filename));
      } catch {
        // Cleanup is best-effort and must preserve the original request error.
      }
    }
  }

  private validate(file: Express.Multer.File): void {
    if (
      !file ||
      !Buffer.isBuffer(file.buffer) ||
      file.size <= 0 ||
      file.size !== file.buffer.length
    ) {
      throw new BadRequestException('بيانات الصورة غير صالحة.');
    }
    if (!PROPERTY_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('نوع الصورة غير مدعوم.');
    }
    if (file.size > MAX_PROPERTY_IMAGE_SIZE) {
      throw new BadRequestException('حجم الصورة يتجاوز 5 ميجابايت.');
    }
    if (!this.signatureMatches(file.buffer, file.mimetype)) {
      throw new BadRequestException('محتوى الصورة لا يطابق نوع الملف.');
    }
  }

  private signatureMatches(buffer: Buffer, mimetype: string): boolean {
    if (mimetype === 'image/jpeg') {
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );
    }
    if (mimetype === 'image/png') {
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).equals(Buffer.from('RIFF')) &&
      buffer.subarray(8, 12).equals(Buffer.from('WEBP'))
    );
  }

  private extensionFor(mimetype: string): string {
    if (mimetype === 'image/png') return '.png';
    if (mimetype === 'image/webp') return '.webp';
    return '.jpg';
  }
}
