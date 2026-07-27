import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SigninDto } from './dto/signin.dto';
import { SignupDto } from './dto/signup.dto';
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
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Request() req: { user: { userId: string } }) {
    return await this.authService.getMe(req.user.userId);
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
