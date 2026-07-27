import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PropertyImageStorageService } from './property-image-storage.service';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('property-image'),
]);

function image(buffer: Buffer, mimetype = 'image/png'): Express.Multer.File {
  return {
    fieldname: 'images',
    originalname: 'property.png',
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
  };
}

describe('PropertyImageStorageService', () => {
  let workspace: string;
  let cwd: jest.SpyInstance<string, []>;
  let service: PropertyImageStorageService;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'property-images-'));
    cwd = jest.spyOn(process, 'cwd').mockReturnValue(workspace);
    service = new PropertyImageStorageService();
  });

  afterEach(async () => {
    cwd.mockRestore();
    await rm(workspace, { recursive: true, force: true });
  });

  it('stores valid files in their received order and deletes them on cleanup', async () => {
    const urls = await service.uploadMany([image(PNG), image(PNG)]);

    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/^\/public\/properties\/[0-9a-f-]{36}\.png$/i);
    expect(urls[1]).not.toBe(urls[0]);
    await expect(
      readFile(path.join(workspace, urls[0].replace('/public/', 'public/'))),
    ).resolves.toEqual(PNG);

    await service.deleteMany(urls);
    await expect(
      readFile(path.join(workspace, urls[0].replace('/public/', 'public/'))),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a spoofed image before writing it', async () => {
    await expect(
      service.uploadMany([image(Buffer.from('not a png'))]),
    ).rejects.toThrow('محتوى الصورة لا يطابق نوع الملف.');
  });
});
