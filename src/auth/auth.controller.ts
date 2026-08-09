import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Request,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { ForgetPasswordDto } from './dto/forget-password.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RequestReactivationDto } from './dto/request-reactivation.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SigninDto } from './dto/signin.dto';
import { SignupDto } from './dto/signup.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';
import { ResendEmailOtpDto } from './dto/resend-email-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async signIn(@Body() signInDto: SigninDto, @Req() req: ExpressRequest) {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    return await this.authService.signIn(
      signInDto.email,
      signInDto.password,
      ip,
    );
  }
  // Always 200 with { sent: true } — never reveals whether the account exists.
  // (Reset-email delivery is a follow-up; the contract only needs this shape.)
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body('email') _email?: string) {
    return { sent: true };
  }

  // Must stay public: deleted and suspended users have no usable session, so
  // this narrow request authenticates with email/password and can only create
  // an activation request or support appeal. It never restores access.
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('request-reactivation')
  async requestReactivation(@Body() dto: RequestReactivationDto) {
    return await this.authService.requestReactivation(
      dto.email,
      dto.password,
      dto.message,
    );
  }

  @Post('register')
  async signUp(@Body() signupDto: SignupDto) {
    return await this.authService.signup(
      signupDto.fullName,
      signupDto.password,
      signupDto.email,
      signupDto.phoneNumber,
      signupDto.role,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailOtpDto) {
    return this.authService.verifyEmail(dto.email, dto.code);
  }

  @HttpCode(HttpStatus.OK)
  @Post('resend-email-verification')
  async resendEmailVerification(@Body() dto: ResendEmailOtpDto) {
    return this.authService.resendEmailVerification(dto.email);
  }
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Request() req: { user: { userId: string } }) {
    return await this.authService.getMe(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(
    @Request() req: { user: { userId: string } },
    @Body()
    dto: { fullName?: string; phoneNumber?: string; avatarUrl?: string | null },
  ) {
    return await this.authService.updateProfile(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('account')
  async deleteAccount(@Request() req: { user: { userId: string } }) {
    return await this.authService.deleteAccount(req.user.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body() refreshDto: RefreshDto) {
    return await this.authService.refresh(refreshDto);
  }
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post(['forgot-password', 'forget-password'])
  async forgetPassword(@Body() dto: ForgetPasswordDto) {
    return await this.authService.forgetPassword(dto.email);
  }
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }
}
