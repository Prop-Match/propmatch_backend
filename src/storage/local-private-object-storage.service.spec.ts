import { ConfigService } from '@nestjs/config';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type { Stats } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalPrivateObjectStorageService } from './local-private-object-storage.service';
import { UploadPrivateObjectInput } from './private-object-storage.interface';

describe('LocalPrivateObjectStorageService', () => {
  let storageRoot: string;
  let service: LocalPrivateObjectStorageService;
  let originalNodeEnv: string | undefined;

  beforeEach(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'propmatch-storage-'));
    service = new LocalPrivateObjectStorageService(
      new ConfigService({ PRIVATE_STORAGE_ROOT: storageRoot }),
    );
  });

  afterEach(async () => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('uploads bytes under an opaque, environment-separated object key', async () => {
    const bytes = Buffer.from('identity document');
    const result = await service.upload({
      data: bytes,
      contentType: 'image/png',
    });

    expect(result.objectKey).toMatch(/^test\/identity\//);
    expect(result.objectKey).toMatch(/\.png$/);
    expect(result.objectKey).not.toContain('passport-photo.png');
    expect(path.isAbsolute(result.objectKey)).toBe(false);
    await expect(
      readFile(path.join(storageRoot, ...result.objectKey.split('/'))),
    ).resolves.toEqual(bytes);
  });

  it('does not include originalName in the upload contract', () => {
    const input: UploadPrivateObjectInput = {
      data: Buffer.from('identity document'),
      contentType: 'image/png',
      // @ts-expect-error Original filenames must not be accepted by this API.
      originalName: 'passport-photo.png',
    };

    expect(input.data).toBeInstanceOf(Buffer);
  });

  it('creates a different key for every upload', async () => {
    const input = {
      data: Buffer.from('identity document'),
      contentType: 'image/jpeg',
    };
    const first = await service.upload(input);
    const second = await service.upload(input);

    expect(first.objectKey).not.toBe(second.objectKey);
    expect(first.objectKey).toMatch(/\.jpg$/);
  });

  it('rejects empty buffers', async () => {
    await expect(
      service.upload({ data: Buffer.alloc(0), contentType: 'image/png' }),
    ).rejects.toThrow('must not be empty');
  });

  it('creates opaque private temporary read references for existing objects', async () => {
    const { objectKey } = await service.upload({
      data: Buffer.from('identity document'),
      contentType: 'application/octet-stream',
    });
    const reference = await service.createTemporaryReadUrl(objectKey, 60);

    expect(reference).toMatch(/^private-local:\/\/read\/[\w-]+$/);
    expect(reference).not.toContain(objectKey);
    expect(reference).not.toContain(storageRoot);
  });

  it('accepts a current-environment identity key', async () => {
    const { objectKey } = await service.upload({
      data: Buffer.from('identity document'),
      contentType: 'image/png',
    });

    await expect(
      service.createTemporaryReadUrl(objectKey, 60),
    ).resolves.toMatch(/^private-local:\/\/read\//);
  });

  it('rejects cross-environment and non-identity object keys', async () => {
    const invalidKeys = [
      'production/identity/file.png',
      'development/identity/file.png',
      'other/identity/file.png',
      'test/other/file.png',
    ];

    for (const objectKey of invalidKeys) {
      await expect(
        service.createTemporaryReadUrl(objectKey, 60),
      ).rejects.toThrow('Invalid private object key');
      await expect(service.delete(objectKey)).rejects.toThrow(
        'Invalid private object key',
      );
    }
  });

  it('uses the default private root for empty or whitespace-only configuration', () => {
    const expectedRoot = path.resolve(process.cwd(), '.private-storage');
    const emptyRootService = new LocalPrivateObjectStorageService(
      new ConfigService({ PRIVATE_STORAGE_ROOT: '' }),
    );
    const whitespaceRootService = new LocalPrivateObjectStorageService(
      new ConfigService({ PRIVATE_STORAGE_ROOT: '   ' }),
    );

    expect(getStorageRoot(emptyRootService)).toBe(expectedRoot);
    expect(getStorageRoot(whitespaceRootService)).toBe(expectedRoot);
  });

  it('requires an existing object and a positive finite integer expiration', async () => {
    await expect(
      service.createTemporaryReadUrl('test/identity/missing.bin', 60),
    ).rejects.toThrow('does not exist');

    const { objectKey } = await service.upload({
      data: Buffer.from('identity document'),
      contentType: 'image/webp',
    });
    for (const expiration of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      await expect(
        service.createTemporaryReadUrl(objectKey, expiration),
      ).rejects.toThrow('positive integer');
    }
  });

  it('rejects traversal, absolute, drive-letter, and null-byte keys', async () => {
    const invalidKeys = [
      '../identity/file.bin',
      '..\\identity\\file.bin',
      '/identity/file.bin',
      'C:\\identity\\file.bin',
      'test/identity/file\0.bin',
    ];

    for (const objectKey of invalidKeys) {
      await expect(
        service.createTemporaryReadUrl(objectKey, 60),
      ).rejects.toThrow('Invalid private object key');
      await expect(service.delete(objectKey)).rejects.toThrow(
        'Invalid private object key',
      );
    }
  });

  it('deletes existing objects and treats a missing valid object as deleted', async () => {
    const { objectKey } = await service.upload({
      data: Buffer.from('identity document'),
      contentType: 'image/png',
    });

    await expect(service.delete(objectKey)).resolves.toBeUndefined();
    await expect(service.delete(objectKey)).resolves.toBeUndefined();
  });

  it('does not rewrite non-ENOENT filesystem errors', async () => {
    const filesystemError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    const testableService = service as unknown as {
      readObjectStats: (objectPath: string) => Promise<Stats>;
    };
    const originalReadObjectStats = testableService.readObjectStats;
    testableService.readObjectStats = () => Promise.reject(filesystemError);

    try {
      await expect(
        service.createTemporaryReadUrl('test/identity/file.png', 60),
      ).rejects.toBe(filesystemError);
    } finally {
      testableService.readObjectStats = originalReadObjectStats;
    }
  });

  it('rejects directories as temporary-read targets', async () => {
    const objectKey = 'test/identity/directory';
    await mkdir(path.join(storageRoot, ...objectKey.split('/')), {
      recursive: true,
    });

    await expect(service.createTemporaryReadUrl(objectKey, 60)).rejects.toThrow(
      'not a regular file',
    );
  });

  it('rejects symbolic links as temporary-read targets when supported', async () => {
    const targetPath = path.join(storageRoot, 'target.png');
    const objectKey = 'test/identity/link.png';
    const linkPath = path.join(storageRoot, ...objectKey.split('/'));
    await writeFile(targetPath, Buffer.from('identity document'));
    await mkdir(path.dirname(linkPath), { recursive: true });

    try {
      await symlink(targetPath, linkPath);
    } catch (error: unknown) {
      expect(getFilesystemErrorCode(error)).toMatch(/^(EPERM|EACCES)$/);
      return;
    }

    await expect(service.createTemporaryReadUrl(objectKey, 60)).rejects.toThrow(
      'not a regular file',
    );
  });

  it('does not write to the console during storage operations', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation();
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const error = jest.spyOn(console, 'error').mockImplementation();

    try {
      const { objectKey } = await service.upload({
        data: Buffer.from('identity document'),
        contentType: 'image/png',
      });
      await service.createTemporaryReadUrl(objectKey, 60);
      await service.delete(objectKey);

      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

function getStorageRoot(service: LocalPrivateObjectStorageService): string {
  return (service as unknown as { storageRoot: string }).storageRoot;
}

function getFilesystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}
