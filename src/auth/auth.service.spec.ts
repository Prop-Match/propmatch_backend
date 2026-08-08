import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService refresh tokens', () => {
  const user = {
    id: 'user-1',
    fullName: 'Test User',
    email: 'user@example.com',
    phoneNumber: '01000000000',
    passwordHash: 'hash',
    role: 'ADMIN',
    avatarUrl: null,
    isActive: true,
    lastLoginAt: null,
    resetToken: null,
    resetTokenExpiry: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    identityVerification: null,
    deletedAt: null as Date | null,
    tokenVersion: 0,
  };

  const jwtService = {
    verifyAsync: jest.fn(),
    signAsync: jest.fn(),
  };

  const userService = {
    findById: jest.fn(),
  };

  const config = new Map<string, string>([
    ['JWT_ACCESS_SECRET', 'access-secret'],
    ['JWT_REFRESH_SECRET', 'refresh-secret'],
    ['JWT_ACCESS_EXPIRES_IN', '1h'],
    ['JWT_REFRESH_EXPIRES_IN', '7d'],
  ]);

  const configService = {
    get: jest.fn(
      (key: string, fallback?: string) => config.get(key) ?? fallback,
    ),
    getOrThrow: jest.fn((key: string) => {
      const value = config.get(key);
      if (!value) throw new Error(`Missing ${key}`);
      return value;
    }),
  };

  const service = new AuthService(
    {} as never,
    userService as never,
    jwtService as unknown as JwtService,
    {} as never,
    configService as unknown as ConfigService,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    userService.findById.mockResolvedValue(user);
    jwtService.signAsync
      .mockResolvedValueOnce('new-access-token')
      .mockResolvedValueOnce('new-refresh-token');
  });

  it('verifies a refresh token with the refresh secret and rotates the pair', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: 0,
      tokenType: 'refresh',
    });

    await expect(
      service.refresh({ refreshToken: 'valid-refresh-token' }),
    ).resolves.toMatchObject({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      user: { id: user.id, role: 'admin' },
    });

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-refresh-token', {
      secret: 'refresh-secret',
    });
    expect(jwtService.signAsync).toHaveBeenNthCalledWith(
      1,
      { sub: user.id, email: user.email, role: 'ADMIN', tokenVersion: 0 },
      { secret: 'access-secret', expiresIn: '1h' },
    );
    expect(jwtService.signAsync).toHaveBeenNthCalledWith(
      2,
      {
        sub: user.id,
        email: user.email,
        role: 'ADMIN',
        tokenVersion: 0,
        tokenType: 'refresh',
      },
      { secret: 'refresh-secret', expiresIn: '7d' },
    );
  });

  it('rejects a refresh token for a soft-deleted user', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: 0,
      tokenType: 'refresh',
    });
    userService.findById.mockResolvedValue({ ...user, deletedAt: new Date() });

    await expect(
      service.refresh({ refreshToken: 'valid-refresh-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('rejects a refresh token minted before a tokenVersion bump', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: 0,
      tokenType: 'refresh',
    });
    userService.findById.mockResolvedValue({ ...user, tokenVersion: 1 });

    await expect(
      service.refresh({ refreshToken: 'valid-refresh-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('rejects a valid JWT that is not a refresh token', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    await expect(
      service.refresh({ refreshToken: 'access-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(userService.findById).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('returns one opaque unauthorized error for an invalid refresh token', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

    await expect(
      service.refresh({ refreshToken: 'expired-refresh-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(userService.findById).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });
});

describe('AuthService — soft-delete edge cases', () => {
  const plainPassword = 'Password123!';
  const passwordHash = bcrypt.hashSync(plainPassword, 4);

  const deletedUser = {
    id: 'user-1',
    fullName: 'Deleted User',
    email: 'deleted@example.com',
    phoneNumber: '01000000000',
    passwordHash,
    role: 'TENANT',
    avatarUrl: null,
    isActive: true,
    lastLoginAt: null,
    resetToken: null,
    resetTokenExpiry: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    identityVerification: null,
    deletedAt: new Date('2026-07-01T00:00:00.000Z'),
    tokenVersion: 0,
  };

  const jwtService = { signAsync: jest.fn() };
  const userService = { findByEmail: jest.fn() };
  const prisma = {
    activationRequest: { findFirst: jest.fn(), create: jest.fn() },
    loginAttempt: { create: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const realtimeService = {
    reactivationRequested: jest.fn(),
    notifyUsers: jest.fn(),
  };

  const service = new AuthService(
    {} as never,
    userService as never,
    jwtService as unknown as JwtService,
    prisma as never,
    {} as unknown as ConfigService,
    realtimeService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findMany.mockResolvedValue([]);
    realtimeService.notifyUsers.mockResolvedValue([]);
  });

  it('rejects login for a soft-deleted user with 403 ACCOUNT_DELETED, even with valid credentials', async () => {
    userService.findByEmail.mockResolvedValue(deletedUser);

    await expect(
      service.signIn(deletedUser.email, plainPassword, '127.0.0.1'),
    ).rejects.toMatchObject({
      status: 403,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      response: expect.objectContaining({ code: 'ACCOUNT_DELETED' }),
    });
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('rejects login for a suspended (not deleted) user with 403 ACCOUNT_SUSPENDED', async () => {
    userService.findByEmail.mockResolvedValue({
      ...deletedUser,
      deletedAt: null,
      suspendedAt: new Date('2026-07-01T00:00:00.000Z'),
      suspendedUntil: null,
      suspensionReason: 'FRAUD',
    });

    await expect(
      service.signIn(deletedUser.email, plainPassword, '127.0.0.1'),
    ).rejects.toMatchObject({
      status: 403,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      response: expect.objectContaining({ code: 'ACCOUNT_SUSPENDED' }),
    });
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('rejects login for a soft-deleted user before checking suspension if the password is wrong', async () => {
    userService.findByEmail.mockResolvedValue(deletedUser);

    await expect(
      service.signIn(deletedUser.email, 'wrong-password', '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('creates a PENDING ActivationRequest for a soft-deleted user with valid credentials', async () => {
    userService.findByEmail.mockResolvedValue(deletedUser);
    prisma.activationRequest.findFirst.mockResolvedValue(null);
    prisma.activationRequest.create.mockResolvedValue({
      id: 'req-1',
      status: 'PENDING',
      createdAt: new Date('2026-08-08T00:00:00.000Z'),
    });
    prisma.user.findMany.mockResolvedValue([
      { id: 'admin-1' },
      { id: 'admin-2' },
    ]);

    await expect(
      service.requestReactivation(deletedUser.email, plainPassword),
    ).resolves.toEqual({ id: 'req-1', status: 'PENDING' });
    expect(prisma.activationRequest.create).toHaveBeenCalledWith({
      data: { userId: deletedUser.id, status: 'PENDING' },
    });
  });

  it('persists a REACTIVATION_REQUEST notification for every admin, and skips the call when there are none', async () => {
    userService.findByEmail.mockResolvedValue(deletedUser);
    prisma.activationRequest.findFirst.mockResolvedValue(null);
    prisma.activationRequest.create.mockResolvedValue({
      id: 'req-1',
      status: 'PENDING',
      createdAt: new Date('2026-08-08T00:00:00.000Z'),
    });
    prisma.user.findMany.mockResolvedValue([
      { id: 'admin-1' },
      { id: 'admin-2' },
    ]);

    await service.requestReactivation(deletedUser.email, plainPassword);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'ADMIN', deletedAt: null },
      select: { id: true },
    });
    expect(realtimeService.notifyUsers).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'admin-1',
        type: 'REACTIVATION_REQUEST',
      }),
      expect.objectContaining({
        userId: 'admin-2',
        type: 'REACTIVATION_REQUEST',
      }),
    ]);
    expect(realtimeService.reactivationRequested).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-1', userId: deletedUser.id }),
    );

    jest.clearAllMocks();
    userService.findByEmail.mockResolvedValue(deletedUser);
    prisma.activationRequest.findFirst.mockResolvedValue(null);
    prisma.activationRequest.create.mockResolvedValue({
      id: 'req-2',
      status: 'PENDING',
      createdAt: new Date('2026-08-08T00:00:00.000Z'),
    });
    prisma.user.findMany.mockResolvedValue([]);

    await service.requestReactivation(deletedUser.email, plainPassword);
    expect(realtimeService.notifyUsers).not.toHaveBeenCalled();
  });

  it('returns the existing PENDING request instead of creating a duplicate', async () => {
    userService.findByEmail.mockResolvedValue(deletedUser);
    prisma.activationRequest.findFirst.mockResolvedValue({
      id: 'existing-req',
      status: 'PENDING',
    });

    await expect(
      service.requestReactivation(deletedUser.email, plainPassword),
    ).resolves.toEqual({ id: 'existing-req', status: 'PENDING' });
    expect(prisma.activationRequest.create).not.toHaveBeenCalled();
  });

  it('rejects a reactivation request for an account that is not deleted', async () => {
    userService.findByEmail.mockResolvedValue({
      ...deletedUser,
      deletedAt: null,
    });

    await expect(
      service.requestReactivation(deletedUser.email, plainPassword),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a reactivation request with a wrong password', async () => {
    userService.findByEmail.mockResolvedValue(deletedUser);

    await expect(
      service.requestReactivation(deletedUser.email, 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.activationRequest.create).not.toHaveBeenCalled();
  });
});
