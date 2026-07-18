import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { VerificationService } from './verification.service';

type AuthenticatedRequest = { user: { userId: string } };

@Controller('verification')
@UseGuards(JwtAuthGuard)
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Get('me')
  getMyVerification(@Request() req: AuthenticatedRequest) {
    return this.verificationService.getMyVerification(req.user.userId);
  }

  @Post('submit')
  submit(
    @Request() req: AuthenticatedRequest,
    @Body() dto: SubmitVerificationDto,
  ) {
    return this.verificationService.submit(req.user.userId, dto);
  }
}
