import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { I18nContext } from 'nestjs-i18n';
import { PrismaService } from '../../prisma/prisma.service';
import { transformUserToFrontend } from '../users/mappers/user.mapper';
import { UsersService } from './../users/users.service';
import { RefreshDto } from './dto/refresh.dto';
@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
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
    const payLoad = { sub: user.id, email: user.email, role: user.role };
    const mappedUser = transformUserToFrontend(user);
    return {
      accessToken: await this.jwtService.signAsync(payLoad),
      refreshToken: await this.jwtService.signAsync(payLoad),
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
                freeListingsLeft: 1,
                optimizerUsesLeft: 2,
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
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      refreshToken: await this.jwtService.signAsync(payload),
      user: mappedUser,
    };
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
      const payload: {
        sub: string;
        email: string;
        role: string;
      } = await this.jwtService.verifyAsync(refreshDto.refreshToken);
      const userId = payload.sub;

      // check if the user of this id exists
      const user = await this.userService.findById(userId);
      if (!user) {
        throw new UnauthorizedException(
          I18nContext.current()?.t('auth.USER_NOT_FOUND'),
        );
      }

      const mappedUser = transformUserToFrontend(user);
      const newPayload = {
        sub: user.id,
        email: user.email,
        role: mappedUser.role,
      };
      return {
        accessToken: await this.jwtService.signAsync(newPayload),
        refreshToken: await this.jwtService.signAsync(newPayload),
        user: mappedUser,
      };
    } catch {
      throw new UnauthorizedException(
        I18nContext.current()?.t('auth.INVALID_REFRESH_TOKEN'),
      );
    }
  }
}
