import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentsService } from './payments.service';
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}
  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  async checkout(
    @Req() req: { user: { userId: string } },
    @Body('paymentType') paymentType: string,
    @Body('amount') amount: number,
  ) {
    return this.paymentsService.checkout(req.user.userId, paymentType, amount);
  }
  @Post('webhook/paymob')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Query() query: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    return this.paymentsService.handleWebhook(query, body);
  }
}
