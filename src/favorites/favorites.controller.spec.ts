import { Test, TestingModule } from '@nestjs/testing';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';

describe('FavoritesController', () => {
  let controller: FavoritesController;
  let serviceMock: {
    getFavorites: jest.Mock;
    addFavorite: jest.Mock;
    removeFavorite: jest.Mock;
  };

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockPropertyId = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    serviceMock = {
      getFavorites: jest.fn(),
      addFavorite: jest.fn(),
      removeFavorite: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FavoritesController],
      providers: [{ provide: FavoritesService, useValue: serviceMock }],
    }).compile();

    controller = module.get<FavoritesController>(FavoritesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getFavorites', () => {
    it('should call service.getFavorites with user id', async () => {
      serviceMock.getFavorites.mockResolvedValue({ items: [] });

      const req = { user: { userId: mockTenantId } };
      const result = await controller.getFavorites(req);

      expect(serviceMock.getFavorites).toHaveBeenCalledWith(mockTenantId);
      expect(result).toEqual({ items: [] });
    });
  });

  describe('addFavorite', () => {
    it('should call service.addFavorite with user id and dto', async () => {
      serviceMock.addFavorite.mockResolvedValue({ favorited: true });

      const req = { user: { userId: mockTenantId } };
      const dto = { propertyId: mockPropertyId };
      const result = await controller.addFavorite(req, dto);

      expect(serviceMock.addFavorite).toHaveBeenCalledWith(mockTenantId, dto);
      expect(result).toEqual({ favorited: true });
    });
  });

  describe('removeFavorite', () => {
    it('should call service.removeFavorite with user id and propertyId', async () => {
      serviceMock.removeFavorite.mockResolvedValue({ favorited: false });

      const req = { user: { userId: mockTenantId } };
      const result = await controller.removeFavorite(req, mockPropertyId);

      expect(serviceMock.removeFavorite).toHaveBeenCalledWith(mockTenantId, mockPropertyId);
      expect(result).toEqual({ favorited: false });
    });
  });
});
