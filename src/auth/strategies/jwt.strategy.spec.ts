import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
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

  const payload = {
    sub: 'user-1',
    email: 'a@test.local',
    role: 'TENANT',
    tokenVersion: 0,
  };

  const baseUser = {
    deletedAt: null as Date | null,
    tokenVersion: 0,
    isActive: true,
    suspendedAt: null as Date | null,
    suspendedUntil: null as Date | null,
    suspensionReason: null as string | null,
  };

  beforeEach(() => jest.clearAllMocks());

  it('accepts a token for an active, non-deleted, non-suspended user with a matching tokenVersion', async () => {
    findUnique.mockResolvedValue({ ...baseUser });
    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: 'user-1',
      email: 'a@test.local',
      role: 'TENANT',
    });
  });

  it('rejects a token for a deactivated (isActive: false) account, before checking deletion/suspension', async () => {
    findUnique.mockResolvedValue({ ...baseUser, isActive: false });
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(strategy.validate(payload)).rejects.toMatchObject({
      status: 403,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      response: expect.not.objectContaining({ code: expect.anything() }),
    });
  });

  it('rejects a token for a soft-deleted user with 403 ACCOUNT_DELETED', async () => {
    findUnique.mockResolvedValue({ ...baseUser, deletedAt: new Date() });
    await expect(strategy.validate(payload)).rejects.toMatchObject({
      status: 403,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      response: expect.objectContaining({ code: 'ACCOUNT_DELETED' }),
    });
  });

  it('rejects a token for a suspended user with 403 ACCOUNT_SUSPENDED, distinct from a deleted user', async () => {
    findUnique.mockResolvedValue({
      ...baseUser,
      suspendedAt: new Date(),
      suspendedUntil: null, // permanent
      suspensionReason: 'FRAUD',
    });
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(strategy.validate(payload)).rejects.toMatchObject({
      status: 403,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      response: expect.objectContaining({ code: 'ACCOUNT_SUSPENDED' }),
    });
  });

  it('lets a user back in once a temporary suspension window has passed', async () => {
    findUnique.mockResolvedValue({
      ...baseUser,
      suspendedAt: new Date('2020-01-01'),
      suspendedUntil: new Date('2020-01-02'), // long expired
      suspensionReason: 'SPAM',
    });
    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: 'user-1',
      email: 'a@test.local',
      role: 'TENANT',
    });
  });

  it('rejects a token whose user no longer exists', async () => {
    findUnique.mockResolvedValue(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token minted before a reactivation bumped tokenVersion', async () => {
    findUnique.mockResolvedValue({ ...baseUser, tokenVersion: 1 });
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a pre-tokenVersion token (undefined !== 0) as a one-time forced re-login', async () => {
    findUnique.mockResolvedValue({ ...baseUser });
    const legacyPayload = {
      sub: 'user-1',
      email: 'a@test.local',
      role: 'TENANT',
    };
    await expect(strategy.validate(legacyPayload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
