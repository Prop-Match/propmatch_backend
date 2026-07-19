import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, mkdir, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  PrivateObjectStorage,
  UploadPrivateObjectInput,
  UploadPrivateObjectResult,
} from './private-object-storage.interface';

type TemporaryReadToken = {
  objectKey: string;
  expiresAt: number;
};

@Injectable()
export class LocalPrivateObjectStorageService implements PrivateObjectStorage {
  private readonly storageRoot: string;
  private readonly temporaryReadTokens = new Map<string, TemporaryReadToken>();
  private readonly readObjectStats = lstat;

  constructor(configService: ConfigService) {
    const configuredRoot = configService
      .get<string>('PRIVATE_STORAGE_ROOT')
      ?.trim();
    const selectedRoot =
      configuredRoot || path.join(process.cwd(), '.private-storage');
    this.storageRoot = path.resolve(selectedRoot);
  }

  async upload(
    input: UploadPrivateObjectInput,
  ): Promise<UploadPrivateObjectResult> {
    if (input.data.length === 0) {
      throw new Error('Private object data must not be empty');
    }

    const objectKey = `${this.environmentPrefix()}/identity/${randomUUID()}${this.extensionFor(input.contentType)}`;
    const objectPath = this.resolveObjectPath(objectKey);

    await mkdir(path.dirname(objectPath), { recursive: true, mode: 0o700 });
    await writeFile(objectPath, input.data, { flag: 'wx', mode: 0o600 });

    return { objectKey };
  }

  async createTemporaryReadUrl(
    objectKey: string,
    expiresInSeconds: number,
  ): Promise<string> {
    if (
      !Number.isFinite(expiresInSeconds) ||
      !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds <= 0
    ) {
      throw new Error('Temporary read expiration must be a positive integer');
    }

    const objectPath = this.resolveObjectPath(objectKey);
    let objectStats: Stats;
    try {
      objectStats = await this.readObjectStats(objectPath);
    } catch (error: unknown) {
      if (this.isMissingFileError(error)) {
        throw new Error('Private object does not exist');
      }

      throw error;
    }

    if (!objectStats.isFile() || objectStats.isSymbolicLink()) {
      throw new Error('Private object is not a regular file');
    }

    this.removeExpiredTemporaryReadTokens();
    const token = randomUUID();
    this.temporaryReadTokens.set(token, {
      objectKey,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    });

    // A protected admin delivery endpoint or production signed-URL adapter is intentionally out of scope.
    return `private-local://read/${token}`;
  }

  async delete(objectKey: string): Promise<void> {
    const objectPath = this.resolveObjectPath(objectKey);
    try {
      await unlink(objectPath);
    } catch (error: unknown) {
      if (this.isMissingFileError(error)) return;
      throw error;
    }
  }

  private environmentPrefix(): string {
    const normalized = (process.env.NODE_ENV ?? 'development')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return normalized || 'development';
  }

  private extensionFor(contentType: string): string {
    switch (contentType.toLowerCase()) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      default:
        return '.bin';
    }
  }

  private resolveObjectPath(objectKey: string): string {
    if (
      !objectKey ||
      !objectKey.startsWith(`${this.environmentPrefix()}/identity/`) ||
      objectKey.includes('\0') ||
      objectKey.includes('\\') ||
      path.isAbsolute(objectKey) ||
      path.posix.isAbsolute(objectKey) ||
      path.win32.isAbsolute(objectKey) ||
      /^[a-zA-Z]:/.test(objectKey)
    ) {
      throw new Error('Invalid private object key');
    }

    const parts = objectKey.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) {
      throw new Error('Invalid private object key');
    }

    const resolvedPath = path.resolve(this.storageRoot, ...parts);
    const relativePath = path.relative(this.storageRoot, resolvedPath);
    if (
      !relativePath ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error('Invalid private object key');
    }

    return resolvedPath;
  }

  private removeExpiredTemporaryReadTokens(): void {
    const now = Date.now();
    for (const [token, metadata] of this.temporaryReadTokens) {
      if (metadata.expiresAt <= now) this.temporaryReadTokens.delete(token);
    }
  }

  private isMissingFileError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    );
  }
}
