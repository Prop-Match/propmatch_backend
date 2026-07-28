import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaymentsService } from './payments.service';
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}
  // Every paymentType (NEW_LISTING/BOOST_LISTING/OFFER_PACK/REFILL_MATCHES)
  // fulfils a landlord quota/property action — tenants have no quota — so
  // only landlords may initiate a checkout.
  @Post('checkout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('LANDLORD')
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
   * provider before any entitlement can be granted.
   */
  @Post(':providerOrderId/reconcile')
  @UseGuards(JwtAuthGuard)
  async reconcile(
    @Req() req: { user: { userId: string } },
    @Param('providerOrderId') providerOrderId: string,
  ) {
    return this.paymentsService.reconcileTransaction(
      req.user.userId,
      providerOrderId,
    );
  }

  @Get(':providerOrderId')
  @UseGuards(JwtAuthGuard)
  async getTransaction(
    @Req() req: { user: { userId: string } },
    @Param('providerOrderId') providerOrderId: string,
  ) {
    return this.paymentsService.getTransaction(
      req.user.userId,
      providerOrderId,
    );
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
