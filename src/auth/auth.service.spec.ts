import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
      { sub: user.id, email: user.email, role: 'ADMIN' },
      { secret: 'access-secret', expiresIn: '1h' },
    );
    expect(jwtService.signAsync).toHaveBeenNthCalledWith(
      2,
      {
        sub: user.id,
        email: user.email,
        role: 'ADMIN',
        tokenType: 'refresh',
      },
      { secret: 'refresh-secret', expiresIn: '7d' },
    );
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
