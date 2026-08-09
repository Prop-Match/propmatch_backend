import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { I18nContext } from 'nestjs-i18n';
import { MailService } from 'src/mail/mail.service';
import { CustomerSupportService } from 'src/customer-support/customer-support.service';
import { isSuspensionActive, suspensionMessage } from '../common/suspension';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { transformUserToFrontend } from '../users/mappers/user.mapper';
import { UsersService } from './../users/users.service';
import { RefreshDto } from './dto/refresh.dto';
import {
  FREE_AI_USES_MONTHLY_ALLOTMENT,
  FREE_OFFERS_MONTHLY_ALLOTMENT,
} from '../payments/pricing.catalog';

type TokenPayload = {
  sub: string;
  email: string;
  role: string;
  tokenVersion: number;
};

type RefreshTokenPayload = TokenPayload & {
  tokenType: 'refresh';
};

const OTP_DIGITS = 6;
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly mailService: MailService,
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly realtimeService: RealtimeService,
    private readonly customerSupportService: CustomerSupportService,
  ) {}

  /**
   * Records admin-panel login attempts for the team activity page. Only
   * ADMIN-role accounts are tracked; a failed login against an unknown email
   * has no user to attribute a role to, so it's not recorded here.
   */
  private async recordAdminLoginAttempt(
    userId: string,
    ip: string,
    success: boolean,
  ): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: { userId, ip, success },
    });
  }

  async signIn(email: string, password: string, ip: string) {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException(
        I18nContext.current()?.t('auth.INVALID_CREDENTIALS'),
      );
    }
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (user.role === 'ADMIN') {
      await this.recordAdminLoginAttempt(user.id, ip, isMatch);
    }
    if (!isMatch) {
      throw new UnauthorizedException(
        I18nContext.current()?.t('auth.INVALID_CREDENTIALS'),
      );
    }
    // A disabled account (admin "تعطيل", or a deactivated user) cannot log in.
    if (!user.isActive) {
      throw new ForbiddenException(
        'تم تعطيل هذا الحساب. برجاء التواصل مع الإدارة.',
      );
    }
    // Valid credentials for a soft-deleted account: reject with a specific
    // code (not the generic 401) so the frontend can distinguish "wrong
    // password" from "this account still exists but was deleted" and offer
    // reactivation instead of just failing. Renamed from ACCOUNT_SUSPENDED
    // to ACCOUNT_DELETED now that real suspension exists below — the two
    // are different account states with different recoveries (self-service
    // reactivation request vs waiting out/appealing a suspension).
    if (user.deletedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ACCOUNT_DELETED',
        message:
          I18nContext.current()?.t('auth.ACCOUNT_DELETED') ||
          'هذا الحساب مجدول للحذف. يمكنك طلب إعادة التفعيل.',
      });
    }
    // Block a suspended account at the door, with the reason + end date.
    if (isSuspensionActive(user)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ACCOUNT_SUSPENDED',
        message: suspensionMessage(user),
      });
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'يرجى تأكيد بريدك الإلكتروني قبل تسجيل الدخول.',
      });
    }
    const payLoad = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
    const mappedUser = transformUserToFrontend(user);
    const tokens = await this.createPairToken(payLoad);
    return {
      ...tokens,
      user: mappedUser,
    };
  }
  async signup(
    fullName: string,
    password: string,
    email: string,
    phoneNumber: string,
    role: 'TENANT' | 'LANDLORD',
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.userService.findByEmail(normalizedEmail);
    if (user) {
      throw new ConflictException(
        I18nContext.current()?.t('auth.EMAIL_EXISTS'),
      );
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const otp = this.createEmailOtp();
    const now = new Date();
    const newUser = await this.userService.create({
      fullName,
      email: normalizedEmail,
      passwordHash,
      phoneNumber,
      role,
      emailOtpHash: this.hashOtp(otp),
      emailOtpExpiresAt: this.otpExpiry(),
      emailOtpAttempts: 0,
      emailOtpSentAt: now,
      ...(role === 'LANDLORD'
        ? {
            userQuota: {
              create: {
                freeListingsLeft: 0,
                optimizerUsesLeft: FREE_AI_USES_MONTHLY_ALLOTMENT,
                freeOffersLeft: FREE_OFFERS_MONTHLY_ALLOTMENT,
              },
            },
          }
        : {}),
    });
    await this.mailService.sendEmailVerificationOtp(newUser.email, fullName, otp);
    return {
      verificationRequired: true,
      email: newUser.email,
      resendAvailableAt: new Date(
        now.getTime() + this.otpResendCooldownSeconds() * 1000,
      ).toISOString(),
    };
  }

  async verifyEmail(email: string, code: string) {
    const user = await this.userService.findByEmail(email.trim().toLowerCase());
    if (!user || user.emailVerifiedAt) {
      throw new BadRequestException('This verification code is invalid or expired.');
    }
    if (!user.emailOtpHash || !user.emailOtpExpiresAt || user.emailOtpExpiresAt <= new Date()) {
      throw new BadRequestException('This verification code is invalid or expired.');
    }
    if (user.emailOtpAttempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Too many invalid attempts. Please request a new code.');
    }
    if (this.hashOtp(code) !== user.emailOtpHash) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailOtpAttempts: { increment: 1 } },
      });
      throw new BadRequestException('This verification code is invalid or expired.');
    }

    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailOtpHash: null,
        emailOtpExpiresAt: null,
        emailOtpAttempts: 0,
      },
      include: { identityVerification: true },
    });
    const payload: TokenPayload = {
      sub: verified.id,
      email: verified.email,
      role: verified.role,
      tokenVersion: verified.tokenVersion,
    };
    return { ...(await this.createPairToken(payload)), user: transformUserToFrontend(verified) };
  }

  async resendEmailVerification(email: string): Promise<{ sent: true }> {
    const user = await this.userService.findByEmail(email.trim().toLowerCase());
    if (!user || user.emailVerifiedAt) return { sent: true };

    const cooldown = this.otpResendCooldownSeconds() * 1000;
    if (user.emailOtpSentAt && user.emailOtpSentAt.getTime() + cooldown > Date.now()) {
      const retryAfterSeconds = Math.ceil(
        (user.emailOtpSentAt.getTime() + cooldown - Date.now()) / 1000,
      );
      throw new HttpException({
        statusCode: 429,
        code: 'EMAIL_VERIFICATION_RESEND_COOLDOWN',
        message: 'يرجى الانتظار قبل طلب رمز جديد.',
        retryAfterSeconds,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const otp = this.createEmailOtp();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailOtpHash: this.hashOtp(otp),
        emailOtpExpiresAt: this.otpExpiry(),
        emailOtpAttempts: 0,
        emailOtpSentAt: new Date(),
      },
    });
    await this.mailService.sendEmailVerificationOtp(user.email, user.fullName, otp);
    return { sent: true };
  }
  /**
   * POST /auth/request-reactivation — public and credential-gated. Deleted
   * accounts create an ActivationRequest; suspended accounts create one open
   * support appeal ticket. Neither path restores access or mints tokens.
   */
  async requestReactivation(email: string, password: string, message?: string) {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      // Same opaque failure whether the email doesn't exist, isn't deleted,
      // or the password is wrong — never confirms account state to a caller
      // who hasn't proven they own the credentials.
      throw new UnauthorizedException(
        I18nContext.current()?.t('auth.INVALID_CREDENTIALS'),
      );
    }
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException(
        I18nContext.current()?.t('auth.INVALID_CREDENTIALS'),
      );
    }

    // A suspended account has no usable JWT by design, so its verified
    // credentials authorize only this narrow operation: create a support
    // appeal ticket. It does not restore access or mint any tokens.
    if (!user.deletedAt && isSuspensionActive(user)) {
      return this.customerSupportService.createSuspensionAppeal(
        { id: user.id, fullName: user.fullName },
        message,
      );
    }

    if (!user.deletedAt) {
      throw new UnauthorizedException(
        I18nContext.current()?.t('auth.INVALID_CREDENTIALS'),
      );
    }

    const existing = await this.prisma.activationRequest.findFirst({
      where: { userId: user.id, status: 'PENDING' },
    });
    if (existing) return { id: existing.id, status: existing.status };

    const request = await this.prisma.activationRequest.create({
      data: { userId: user.id, status: 'PENDING' },
    });

    // Persisted admin-facing notification, so the bell dropdown's HTTP
    // fetch (GET /notifications) shows it too, not just the live toast —
    // reactivationRequested() below is delivery-only and ephemeral.
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', deletedAt: null },
      select: { id: true },
    });
    if (admins.length > 0) {
      await this.realtimeService.notifyUsers(
        admins.map((admin) => ({
          userId: admin.id,
          type: 'REACTIVATION_REQUEST',
          title: 'طلب إعادة تفعيل حساب جديد',
          message: `${user.fullName} (${user.email}) طلب إعادة تفعيل حسابه المحذوف.`,
          link: '/admin/reactivations',
        })),
      );
    }

    this.realtimeService.reactivationRequested({
      requestId: request.id,
      userId: user.id,
      userFullName: user.fullName,
      userEmail: user.email,
      createdAt: request.createdAt,
    });
    return { id: request.id, status: request.status };
  }

  async getMe(userId: string) {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new UnauthorizedException(
        I18nContext.current()?.t('auth.USER_NOT_FOUND'),
      );
    }
    return transformUserToFrontend(user);
  }
  async refresh(refreshDto: RefreshDto) {
    try {
      const payload: RefreshTokenPayload =
        await this.jwtService.verifyAsync<RefreshTokenPayload>(
          refreshDto.refreshToken,
          {
            secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
          },
        );
      if (payload.tokenType !== 'refresh') {
        throw new UnauthorizedException();
      }
      const userId = payload.sub;

      // check if the user of this id exists
      const user = await this.userService.findById(userId);
      if (!user) {
        throw new UnauthorizedException(
          I18nContext.current()?.t('auth.USER_NOT_FOUND'),
        );
      }
      // Same revocation guarantee as JwtStrategy, applied to the refresh
      // path too — otherwise a refresh token minted before a deletion,
      // suspension, or reactivation could keep silently minting fresh
      // access tokens forever, bypassing the access-token check entirely.
      if (
        user.deletedAt ||
        isSuspensionActive(user) ||
        payload.tokenVersion !== user.tokenVersion
      ) {
        throw new UnauthorizedException();
      }

      const mappedUser = transformUserToFrontend(user);
      const newPayload: TokenPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.tokenVersion,
      };
      const tokens = await this.createPairToken(newPayload);

      return {
        ...tokens,
        user: mappedUser,
      };
    } catch {
      throw new UnauthorizedException(
        I18nContext.current()?.t('auth.INVALID_REFRESH_TOKEN'),
      );
    }
  }
  async forgetPassword(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      throw new UnauthorizedException(
        I18nContext.current()?.t('auth.USER_NOT_FOUND'),
      );
    }
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: hashedToken,
        resetTokenExpiry: expiry,
      },
    });
    await this.mailService.sendPasswordResetEmail(user.email, rawToken);

    return {
      message:
        I18nContext.current()?.t('auth.PASSWORD_RESET_SENT') ||
        'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.',
    };
  }

  async resetPassword(
    rawToken: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const hashedToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    const user = await this.prisma.user.findFirst({
      where: {
        resetToken: hashedToken,
        resetTokenExpiry: { gt: new Date() }, // Ensure token has not expired
      },
    });
    if (!user) {
      throw new BadRequestException(
        I18nContext.current()?.t('auth.INVALID_RESET_TOKEN') ||
          'رابط إعادة التعيين غير صالحة أو انتهت صلاحيتها.',
      );
    }
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });
    return { message: 'تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.' };
  }

  async updateProfile(
    userId: string,
    dto: { fullName?: string; phoneNumber?: string; avatarUrl?: string | null },
  ) {
    const updated = await this.userService.updateProfile(userId, dto);
    return transformUserToFrontend(updated);
  }

  async deleteAccount(userId: string) {
    await this.userService.deleteAccount(userId);
    return { message: 'تم حذف الحساب بنجاح' };
  }

  async createSocketTicket(userId: string): Promise<{ token: string }> {
    const user = await this.userService.findById(userId);
    if (!user) throw new UnauthorizedException();
    const token = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.tokenVersion,
      },
      {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: '5m',
      },
    );
    return { token };
  }

  private createEmailOtp(): string {
    return crypto.randomInt(0, 10 ** OTP_DIGITS).toString().padStart(OTP_DIGITS, '0');
  }

  private hashOtp(code: string): string {
    return crypto
      .createHmac(
        'sha256',
        this.configService.getOrThrow<string>('EMAIL_OTP_SECRET'),
      )
      .update(code)
      .digest('hex');
  }

  private otpExpiry(): Date {
    return new Date(Date.now() + this.otpTtlMinutes() * 60 * 1000);
  }

  private otpTtlMinutes(): number {
    return this.positiveIntegerConfig('EMAIL_OTP_TTL_MINUTES', 10);
  }

  private otpResendCooldownSeconds(): number {
    return this.positiveIntegerConfig('EMAIL_OTP_RESEND_COOLDOWN_SECONDS', 60);
  }

  private positiveIntegerConfig(name: string, fallback: number): number {
    const raw = this.configService.get<string>(name)?.trim();
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${name} must be a positive integer.`);
    }
    return parsed;
  }

  private signAccessToken(payload: TokenPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.get<JwtSignOptions['expiresIn']>(
        'JWT_ACCESS_EXPIRES_IN',
        '1h',
      ),
    });
  }

  private signRefreshToken(payload: TokenPayload): Promise<string> {
    return this.jwtService.signAsync(
      { ...payload, tokenType: 'refresh' },
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<JwtSignOptions['expiresIn']>(
          'JWT_REFRESH_EXPIRES_IN',
          '7d',
        ),
      },
    );
  }

  private async createPairToken(
    payload: TokenPayload,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(payload),
      this.signRefreshToken(payload),
    ]);
    return { accessToken, refreshToken };
  }
}
