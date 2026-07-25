import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AxiosError, AxiosResponse } from 'axios';
import * as crypto from 'crypto';
import { PrismaService } from 'prisma/prisma.service';
import { firstValueFrom } from 'rxjs';
import {
  IPaymentGateway,
  WebhookResult,
} from '../interfaces/payment-gateway.interface';
import {
  PaymobTransactionLookupResponse,
  PaymobWebhookTransaction,
} from '../interfaces/paymob.types';

@Injectable()
export class PaymobService implements IPaymentGateway {
  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly logger = new Logger();
  private readonly BASE_URL =
    process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com';
  private readonly SECRET_KEY = process.env.PAYMOB_SECRET_KEY as string;
  private readonly PUBLIC_KEY = process.env.PAYMOB_PUBLIC_KEY as string;
  private readonly HMAC_SECRET = process.env.PAYMOB_HMAC_SECRET as string;

  async generatePaymentUrl(
    userId: string,
    paymentType: string,
    amount: number,
  ): Promise<{ checkoutUrl: string; providerOrderId: string }> {
    try {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });

      // 1. Get temporary Auth Token
      const authRes: AxiosResponse<{ token: string }> = await firstValueFrom(
        this.httpService.post(`${this.BASE_URL}/api/auth/tokens`, {
          api_key: process.env.PAYMOB_API_KEY,
        }),
      );
      const token = String(authRes.data.token);

      // 2. Register Order
      const orderRes: AxiosResponse<{ id: number }> = await firstValueFrom(
        this.httpService.post(`${this.BASE_URL}/api/ecommerce/orders`, {
          auth_token: token,
          delivery_needed: 'false',
          amount_cents: Math.round(amount * 100),
          currency: 'EGP',
          items: [],
        }),
      );
      const orderId = Number(orderRes.data.id);

      // 3. Get Payment Key
      const keyRes: AxiosResponse<{ token: string }> = await firstValueFrom(
        this.httpService.post(`${this.BASE_URL}/api/acceptance/payment_keys`, {
          auth_token: token,
          amount_cents: Math.round(amount * 100),
          expiration: 3600,
          order_id: orderId,
          billing_data: {
            apartment: 'NA',
            email: user.email,
            floor: 'NA',
            first_name: user.fullName || 'NA',
            street: 'NA',
            building: 'NA',
            phone_number: user.phoneNumber || 'NA',
            shipping_method: 'NA',
            postal_code: 'NA',
            city: 'NA',
            country: 'EG',
            last_name: 'NA',
            state: 'NA',
          },
          currency: 'EGP',
          integration_id: Number(process.env.PAYMOB_INTEGRATION_ID),
        }),
      );
      const paymentToken = String(keyRes.data.token);

      return {
        checkoutUrl: `${this.BASE_URL}/api/acceptance/iframes/${process.env.PAYMOB_IFRAME_ID}?payment_token=${paymentToken}`,
        providerOrderId: String(orderId),
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      const errorData = axiosError.response?.data
        ? JSON.stringify(axiosError.response.data)
        : '';
      this.logger.error(
        'Paymob Checkout Error:',
        errorData || axiosError.message || axiosError,
      );
      throw new BadRequestException('Paymob payment initiation failed');
    }
  }

  processWebhook(
    query: Record<string, string>,
    body: Record<string, unknown>,
  ): WebhookResult {
    const obj = body?.obj as PaymobWebhookTransaction | undefined;
    if (!obj) {
      return { success: false, isFinal: false, isValid: false, transactionId: '' };
    }
    const fields = [
      obj.amount_cents,
      obj.created_at,
      obj.currency,
      obj.error_occured,
      obj.has_parent_transaction,
      obj.id,
      obj.integration_id,
      obj.is_3d_secure,
      obj.is_auth,
      obj.is_capture,
      obj.is_refunded,
      obj.is_standalone_payment,
      obj.is_voided,
      obj.order?.id,
      obj.owner,
      obj.pending,
      obj.source_data?.pan,
      obj.source_data?.sub_type,
      obj.source_data?.type,
      obj.success,
    ];

    const hmacString = fields.map(String).join('');
    const computed = crypto
      .createHmac('sha512', this.HMAC_SECRET)
      .update(hmacString)
      .digest('hex');
    const receivedHmac = String(query.hmac || '');

    const isValid =
      computed.length === receivedHmac.length &&
      crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(receivedHmac));

    if (!isValid) {
      this.logger.error(`HMAC validation failed!`);
      this.logger.error(`String hashed: "${hmacString}"`);
      this.logger.error(`Computed HMAC:  ${computed}`);
      this.logger.error(`Received HMAC:  ${receivedHmac}`);
      return { isValid: false, success: false, isFinal: false, transactionId: '' };
    }
    const extras = obj.payment_key_claims?.extra || obj.order?.data;
    return {
      isValid: true,
      success: obj.success === true && obj.pending === false,
      isFinal: obj.pending === false,
      transactionId: String(obj.id),
      providerOrderId: String(obj.order?.id),
      paymentType: extras?.paymentType,
      userId: extras?.userId,
    };
  }
  async checkTransactionStatus(
    providerOrderId: string,
  ): Promise<{ isSuccessful: boolean; transactionId?: string }> {
    try {
      // 1. Get a temporary auth token.
      const response: AxiosResponse<{ token: string }> = await firstValueFrom(
        this.httpService.post('https://accept.paymob.com/api/auth/tokens', {
          api_key: process.env.PAYMOB_API_KEY,
        }),
      );
      const token = String(response.data.token);
      // The legacy order endpoint exposes the amount but omits transaction
      // results. Query the acceptance transactions endpoint instead and match
      // the requested order explicitly (some Paymob accounts return a page of
      // recent transactions even when the order query is supplied).
      const transactionReq: AxiosResponse<PaymobTransactionLookupResponse> =
        await firstValueFrom(
          this.httpService.get(
            `${this.BASE_URL}/api/acceptance/transactions?order=${encodeURIComponent(providerOrderId)}&token=${encodeURIComponent(token)}`,
          ),
        );
      const successfulTx = (transactionReq.data.results || []).find(
        (t) =>
          t &&
          String(t.order?.id) === providerOrderId &&
          t.success === true &&
          t.pending !== true &&
          t.is_voided === false &&
          t.is_refunded === false,
      );
      if (successfulTx) {
        return { isSuccessful: true, transactionId: String(successfulTx.id) };
      }
      return { isSuccessful: false };
    } catch (e) {
      this.logger.error(
        `Failed to check status for order ${providerOrderId}`,
        e,
      );
      return { isSuccessful: false };
    }
  }
}
