import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

export type ChatAttachmentType = 'IMAGE' | 'VIDEO' | 'AUDIO';

export interface StoredChatAttachment {
  url: string;
  type: ChatAttachmentType;
  name: string;
  sizeBytes: number;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_AV_BYTES = 25 * 1024 * 1024; // 25 MB (video / audio)

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
};

/**
 * Stores a chat attachment (image / video / voice note) under the statically
 * served public dir, so it can be rendered inline via a plain URL. Enforces
 * per-type size caps and an allow-list of media MIME types.
 */
@Injectable()
export class ChatUploadStorageService {
  private readonly logger = new Logger(ChatUploadStorageService.name);
  private readonly root = path.resolve(
    process.cwd(),
    'public',
    'uploads',
    'chat',
  );

  private classify(mimetype: string): ChatAttachmentType | null {
    if (mimetype.startsWith('image/')) return 'IMAGE';
    if (mimetype.startsWith('video/')) return 'VIDEO';
    if (mimetype.startsWith('audio/')) return 'AUDIO';
    return null;
  }

  async store(file: Express.Multer.File): Promise<StoredChatAttachment> {
    // MediaRecorder sends e.g. "audio/webm;codecs=opus" — strip params before lookup.
    const mime = (file.mimetype || '').split(';')[0].trim().toLowerCase();
    const type = this.classify(mime);
    if (!type || !EXT_BY_MIME[mime]) {
      throw new BadRequestException('نوع الملف غير مدعوم');
    }
    const cap = type === 'IMAGE' ? MAX_IMAGE_BYTES : MAX_AV_BYTES;
    if (file.size > cap) {
      const mb = Math.round(cap / (1024 * 1024));
      throw new BadRequestException(
        `حجم الملف يتجاوز الحد المسموح (${mb} ميجابايت)`,
      );
    }

    await mkdir(this.root, { recursive: true });
    const filename = `${randomUUID()}${EXT_BY_MIME[mime]}`;
    await writeFile(path.join(this.root, filename), file.buffer);

    return {
      url: `/public/uploads/chat/${filename}`,
      type,
      name: file.originalname?.slice(0, 200) || filename,
      sizeBytes: file.size,
    };
  }

  /**
   * Best-effort removal of a stored chat attachment by its public URL, so a
   * deleted message doesn't orphan its file in the volume. Only deletes within
   * this service's own directory (rejects traversal / foreign paths), and never
   * throws — a missing file must not fail the message delete.
   */
  async deleteByUrl(url: string | null | undefined): Promise<void> {
    if (!url) return;
    const prefix = '/public/uploads/chat/';
    if (!url.startsWith(prefix)) return;
    const filename = path.basename(url); // strips any path segments → no traversal
    const target = path.join(this.root, filename);
    if (path.dirname(target) !== this.root) return; // defence-in-depth
    try {
      await unlink(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn(
          `Failed to delete chat attachment ${filename}: ${String(error)}`,
        );
      }
    }
  }
}
