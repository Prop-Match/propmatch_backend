jest.mock(
  '@generated/prisma/enums',
  () => ({
    PropertyType: { APARTMENT: 'APARTMENT', VILLA: 'VILLA', STUDIO: 'STUDIO' },
  }),
  { virtual: true },
);

import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { PropertyImageStorageService } from './property-image-storage.service';
import { FormOptimizerService } from './services/FormOptimizer.service';
import { QuotaService } from '../quota/quota.service';

function controller(
  create: jest.Mock,
  uploadMany: jest.Mock,
  deleteMany: jest.Mock,
  update = jest.fn(),
  remove = jest.fn(),
) {
  return new PropertiesController(
    { create, update, remove } as unknown as PropertiesService,
    {} as FormOptimizerService,
    {} as QuotaService,
    { uploadMany, deleteMany } as unknown as PropertyImageStorageService,
  );
}

describe('PropertiesController multipart submission', () => {
  const request = { user: { userId: 'owner-1' } };
  const dto = {
    title: 'Property title',
    description: 'A sufficiently detailed property description',
  } as never;
  const files = [{ originalname: 'cover.jpg' }, { originalname: 'room.png' }];

  it('passes stored image URLs to property creation in upload order', async () => {
    const uploadMany = jest
      .fn()
      .mockResolvedValue([
        '/public/properties/cover.jpg',
        '/public/properties/room.png',
      ]);
    const create = jest
      .fn()
      .mockResolvedValue({ property: { id: 'property-1' } });
    const deleteMany = jest.fn();
    const subject = controller(create, uploadMany, deleteMany);

    await expect(subject.create(request, dto, files as never)).resolves.toEqual(
      {
        property: { id: 'property-1' },
      },
    );
    expect(create).toHaveBeenCalledWith('owner-1', {
      ...dto,
      images: ['/public/properties/cover.jpg', '/public/properties/room.png'],
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('deletes uploaded images when property creation fails', async () => {
    const urls = [
      '/public/properties/cover.jpg',
      '/public/properties/room.png',
    ];
    const uploadMany = jest.fn().mockResolvedValue(urls);
    const create = jest
      .fn()
      .mockRejectedValue(new Error('database unavailable'));
    const deleteMany = jest.fn().mockResolvedValue(undefined);
    const subject = controller(create, uploadMany, deleteMany);

    await expect(subject.create(request, dto, files as never)).rejects.toThrow(
      'database unavailable',
    );
    expect(deleteMany).toHaveBeenCalledWith(urls);
  });

  it('updates a property without requiring new images and cleans up removed files', async () => {
    const uploadMany = jest.fn();
    const create = jest.fn();
    const deleteMany = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue({
      response: { property: { id: 'property-1', status: 'PENDING' } },
      removedImageUrls: ['/public/properties/old.jpg'],
    });
    const subject = controller(create, uploadMany, deleteMany, update);
    const editDto = {
      ...dto,
      existingImageIds: ['image-1'],
    } as never;

    await expect(
      subject.update(request, 'property-1', editDto, []),
    ).resolves.toEqual({
      property: { id: 'property-1', status: 'PENDING' },
    });
    expect(uploadMany).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('owner-1', 'property-1', editDto, []);
    expect(deleteMany).toHaveBeenCalledWith(['/public/properties/old.jpg']);
  });

  it('deletes newly uploaded edit images when the database update fails', async () => {
    const urls = ['/public/properties/new.jpg'];
    const uploadMany = jest.fn().mockResolvedValue(urls);
    const create = jest.fn();
    const deleteMany = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockRejectedValue(new Error('update failed'));
    const subject = controller(create, uploadMany, deleteMany, update);

    await expect(
      subject.update(request, 'property-1', dto, files as never),
    ).rejects.toThrow('update failed');
    expect(deleteMany).toHaveBeenCalledWith(urls);
  });

  it('soft-deletes only through the authenticated owner service call', async () => {
    const remove = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 'ARCHIVED' });
    const subject = controller(
      jest.fn(),
      jest.fn(),
      jest.fn(),
      jest.fn(),
      remove,
    );

    await expect(subject.remove(request, 'property-1')).resolves.toEqual({
      ok: true,
      status: 'ARCHIVED',
    });
    expect(remove).toHaveBeenCalledWith('owner-1', 'property-1');
  });
});
