import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';

const unverifiedUser = {
  id: 'user-1',
  fullName: 'Test User',
  email: 'user@example.com',
  phoneNumber: '01000000000',
  passwordHash: 'hash',
  role: 'TENANT',
  avatarUrl: null,
  adminRole: null,
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
  tokenVersion: 0,
  suspendedAt: null,
  suspendedUntil: null,
  suspensionReason: null,
  suspensionNote: null,
  suspendedById: null,
  resetToken: null,
  resetTokenExpiry: null,
  emailVerifiedAt: null,
  emailOtpHash: null,
  emailOtpExpiresAt: null,
  emailOtpAttempts: 0,
  emailOtpSentAt: null,
};

function createService(environment: string, bypassEnabled: string) {
  const userService = {
    findByEmail: jest.fn().mockResolvedValue(unverifiedUser),
  };
  const prisma = {
    user: {
      update: jest.fn().mockImplementation(({ data }: { data: object }) => ({
        ...unverifiedUser,
        ...data,
        identityVerification: null,
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      })),
    },
  };
  const jwtService = {
    signAsync: jest
      .fn()
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token'),
  };
  const values: Record<string, string> = {
    NODE_ENV: environment,
    EMAIL_OTP_DEV_BYPASS_ENABLED: bypassEnabled,
    EMAIL_OTP_SECRET: 'otp-secret',
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
  };
  const configService = {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => {
      const value = values[key];
      if (!value) throw new Error(`Missing ${key}`);
      return value;
    }),
  };

  return {
    prisma,
    service: new AuthService(
      {} as never,
      userService as never,
      jwtService as unknown as JwtService,
      prisma as never,
      configService as unknown as ConfigService,
      {} as never,
      {} as never,
    ),
  };
}

describe('AuthService development email OTP', () => {
  it('accepts 123456 when the non-production bypass is explicitly enabled', async () => {
    const { prisma, service } = createService('development', 'true');

    await expect(
      service.verifyEmail(unverifiedUser.email, '123456'),
    ).resolves.toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { email: unverifiedUser.email },
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
      }),
    );
  });

  it('never accepts the bypass code in production', async () => {
    const { prisma, service } = createService('production', 'true');

    await expect(
      service.verifyEmail(unverifiedUser.email, '123456'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('requires the bypass flag outside production', async () => {
    const { prisma, service } = createService('development', 'false');

    await expect(
      service.verifyEmail(unverifiedUser.email, '123456'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
