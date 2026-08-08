import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { I18nContext } from 'nestjs-i18n';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { transformUserToFrontend } from '../users/mappers/user.mapper';
import { UsersService } from './../users/users.service';
import { RefreshDto } from './dto/refresh.dto';

type TokenPayload = {
  sub: string;
  email: string;
  role: string;
  tokenVersion: number;
};

type RefreshTokenPayload = TokenPayload & {
  tokenType: 'refresh';
};

@Injectable()
export class AuthService {
  constructor(
    private readonly mailService: MailService,
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly realtimeService: RealtimeService,
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
    // Valid credentials for a soft-deleted account: reject with a specific
    // code (not the generic 401) so the frontend can distinguish "wrong
    // password" from "this account still exists but was deleted" and offer
    // reactivation instead of just failing.
    if (user.deletedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ACCOUNT_SUSPENDED',
        message:
          I18nContext.current()?.t('auth.ACCOUNT_SUSPENDED') ||
          'هذا الحساب مجدول للحذف. يمكنك طلب إعادة التفعيل.',
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
    const user = await this.userService.findByEmail(email);
    if (user) {
      throw new ConflictException(
        I18nContext.current()?.t('auth.EMAIL_EXISTS'),
      );
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const newUser = await this.userService.create({
      fullName,
      email,
      passwordHash,
      phoneNumber,
      role,
      ...(role === 'LANDLORD'
        ? {
            userQuota: {
              create: {
                freeListingsLeft: 0,
                optimizerUsesLeft: 0,
                freeOffersLeft: 3,
              },
            },
          }
        : {}),
    });
    const userWithRelations = await this.userService.findById(newUser.id);
    if (!userWithRelations) {
      throw new ConflictException(
        I18nContext.current()?.t('auth.REGISTRATION_FAILED'),
      );
    }
    const mappedUser = transformUserToFrontend(userWithRelations);
    const payload = {
      sub: newUser.id,
      email: newUser.email,
      role: newUser.role,
      tokenVersion: newUser.tokenVersion,
    };
    const tokens = await this.createPairToken(payload);
    return {
      ...tokens,
      user: mappedUser,
    };
  }
  /**
   * POST /auth/request-reactivation — public. Requires the password (not
   * just the email) so this can't be used to probe whether an arbitrary
   * email is a deleted account. Creates one PENDING ActivationRequest; a
   * user who already has a pending request just gets that one back rather
   * than piling up duplicates for an admin to review.
   */
  async requestReactivation(email: string, password: string) {
    const user = await this.userService.findByEmail(email);
    if (!user || !user.deletedAt) {
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
      // path too — otherwise a refresh token minted before a deletion or
      // reactivation could keep silently minting fresh access tokens
      // forever, bypassing the access-token check entirely.
      if (user.deletedAt || payload.tokenVersion !== user.tokenVersion) {
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
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}`;
    console.log(
      `[AUTH DEBUG] Password reset URL for ${user.email}: ${resetUrl}`,
    );
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
