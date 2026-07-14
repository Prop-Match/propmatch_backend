import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SigninDto } from './dto/signin.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async signIn(@Body() signInDto: SigninDto) {
    return await this.authService.signIn(signInDto.email, signInDto.password);
  }
  @Post('register')
  async signUp(@Body() signupDto: SignupDto) {
    return await this.authService.signup(
      signupDto.fullName,
      signupDto.password,
      signupDto.email,
      signupDto.phoneNumber,
    );
  }
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Request() req: { user: { userId: string } }) {
    return await this.authService.getMe(req.user.userId);
  }
}
