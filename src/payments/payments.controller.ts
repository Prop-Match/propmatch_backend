import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Get,
  Param,
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
  ) {
    return this.paymentsService.checkout(req.user.userId, paymentType);
  }

  @Post('reconcile-pending')
  @UseGuards(JwtAuthGuard)
  async reconcilePending(@Req() req: { user: { userId: string } }) {
    return this.paymentsService.reconcilePendingForUser(req.user.userId);
  }

  /**
   * Lets the signed-in buyer refresh a transaction after returning from the
   * hosted checkout. The server, not the browser, verifies its state with
   * Paymob before any entitlement can be granted.
   */
  @Post(':paymobOrderId/reconcile')
  @UseGuards(JwtAuthGuard)
  async reconcile(
    @Req() req: { user: { userId: string } },
    @Param('paymobOrderId') paymobOrderId: string,
  ) {
    return this.paymentsService.reconcileTransaction(
      req.user.userId,
      paymobOrderId,
    );
  }

  @Get(':paymobOrderId')
  @UseGuards(JwtAuthGuard)
  async getTransaction(
    @Req() req: { user: { userId: string } },
    @Param('paymobOrderId') paymobOrderId: string,
  ) {
    return this.paymentsService.getTransaction(req.user.userId, paymobOrderId);
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
