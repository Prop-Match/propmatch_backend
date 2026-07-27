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
) {
  return new PropertiesController(
    { create } as unknown as PropertiesService,
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
});
