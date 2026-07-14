import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { I18nContext } from 'nestjs-i18n';
import { transformUserToFrontend } from '../users/mappers/user.mapper';
import { UsersService } from './../users/users.service';
@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async signIn(email: string, password: string) {
    const user = await this.userService.findByEmail(email);
    if (!user) {
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
    const payLoad = { sub: user.id, email: user.email, role: user.role };
    const mappedUser = transformUserToFrontend(user);
    return {
      accesstoken: await this.jwtService.signAsync(payLoad),
      refreshToken: await this.jwtService.signAsync(payLoad),
      user: mappedUser,
    };
  }
  async signup(
    fullName: string,
    password: string,
    email: string,
    phoneNumber: string,
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
      userQuota: {
        create: {
          freeListingsLeft: 1,
          freeMatchSearchesLeft: 3,
          optimizerUsesLeft: 5,
        },
      },
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
    return { user: transformUserToFrontend(user) };
  }
}
