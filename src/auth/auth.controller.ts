import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SigninDto } from './dto/signin.dto';
import { SignupDto } from './dto/signup.dto';
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async signIn(@Body() signInDto: SigninDto) {
    return await this.authService.signIn(signInDto.email, signInDto.password);
  }
  @Post('signup')
  async signUp(@Body() signupDto: SignupDto) {
    return await this.authService.signup(
      signupDto.fullName,
      signupDto.password,
      signupDto.email,
    );
  }
}
