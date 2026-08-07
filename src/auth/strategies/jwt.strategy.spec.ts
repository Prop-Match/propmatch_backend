import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';

describe('JwtStrategy', () => {
  const findUnique = jest.fn();
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('test-secret'),
  } as unknown as ConfigService;
  const strategy = new JwtStrategy(configService, {
    user: { findUnique },
  } as unknown as PrismaService);

  const payload = { sub: 'user-1', email: 'a@test.local', role: 'TENANT' };

  beforeEach(() => jest.clearAllMocks());

  it('accepts a token for an active, non-deleted user', async () => {
    findUnique.mockResolvedValue({ deletedAt: null });
    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: 'user-1',
      email: 'a@test.local',
      role: 'TENANT',
    });
  });

  it('rejects a token for a soft-deleted user', async () => {
    findUnique.mockResolvedValue({ deletedAt: new Date() });
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token whose user no longer exists', async () => {
    findUnique.mockResolvedValue(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
