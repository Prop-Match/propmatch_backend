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

const CARD_UNAVAILABLE_MESSAGE =
  'خدمة الدفع بالبطاقات غير متاحة حالياً. حاول مرة أخرى لاحقاً.';
const WALLET_UNAVAILABLE_MESSAGE =
  'خدمة الدفع بالمحفظة الإلكترونية غير متاحة حالياً. حاول مرة أخرى لاحقاً.';

@Injectable()
export class PaymobService implements IPaymentGateway {
  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly logger = new Logger(PaymobService.name);
  private readonly BASE_URL =
    process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com';
  private readonly SECRET_KEY = process.env.PAYMOB_SECRET_KEY as string;
  private readonly PUBLIC_KEY = process.env.PAYMOB_PUBLIC_KEY as string;
  private readonly HMAC_SECRET = process.env.PAYMOB_HMAC_SECRET as string;

  async generatePaymentUrl(
    userId: string,
    paymentType: string,
    amount: number,
    method?: 'CARD' | 'WALLET',
    walletPhone?: string,
  ): Promise<{ checkoutUrl: string; providerOrderId: string }> {
    try {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });

      const walletIntegrationId =
        process.env.PAYMOB_WALLET_INTEGRATION_ID ||
        process.env.PAYMOB_INTEGRATION_ID_WALLET;
      const cardIntegrationId =
        process.env.PAYMOB_INTEGRATION_ID_CARD ||
        process.env.PAYMOB_INTEGRATION_ID;

      // 1. If PAYMOB_SECRET_KEY is provided, use Intention API + Unified Checkout as specified in code-nodejs.md
      if (this.SECRET_KEY) {
        const selectedIntegrationId =
          method === 'WALLET' ? walletIntegrationId : cardIntegrationId;
        if (!selectedIntegrationId) {
          this.logger.error(
            `Paymob ${method === 'WALLET' ? 'wallet' : 'card'} integration ID is missing`,
          );
          throw new BadRequestException(
            method === 'WALLET'
              ? WALLET_UNAVAILABLE_MESSAGE
              : CARD_UNAVAILABLE_MESSAGE,
          );
        }

        const intentionRes: AxiosResponse<{
          id: number | string;
          client_secret: string;
        }> = await firstValueFrom(
          this.httpService.post(
            `${this.BASE_URL}/v1/intention/`,
            {
              amount: Math.round(amount * 100),
              currency: 'EGP',
              payment_methods: [Number(selectedIntegrationId)],
              special_reference: `${paymentType}_${userId}_${Date.now()}`,
              billing_data: {
                first_name: user.fullName || 'NA',
                last_name: 'NA',
                email: user.email,
                phone_number: walletPhone || user.phoneNumber || 'NA',
                apartment: 'NA',
                floor: 'NA',
                street: 'NA',
                building: 'NA',
                shipping_method: 'NA',
                postal_code: 'NA',
                city: 'NA',
                state: 'NA',
                country: 'EGY',
              },
              customer: {
                first_name: user.fullName || 'NA',
                last_name: 'NA',
                email: user.email,
              },
            },
            {
              headers: {
                Authorization: `Token ${this.SECRET_KEY}`,
                'Content-Type': 'application/json',
              },
            },
          ),
        );

        const clientSecret = String(intentionRes.data.client_secret);
        const intentionId = String(intentionRes.data.id);
        const checkoutUrl = `${this.BASE_URL}/unifiedcheckout/?publicKey=${this.PUBLIC_KEY}&clientSecret=${clientSecret}`;

        return {
          checkoutUrl,
          providerOrderId: intentionId,
        };
      }

      // 2. Legacy API (Acceptance API)
      if (method === 'WALLET' && !walletIntegrationId) {
        this.logger.error(
          'Mobile Wallet checkout requested but PAYMOB_WALLET_INTEGRATION_ID is missing in .env!',
        );
        throw new BadRequestException(WALLET_UNAVAILABLE_MESSAGE);
      }
      if (method === 'WALLET' && !walletPhone) {
        throw new BadRequestException(
          'أدخل رقم الهاتف المرتبط بالمحفظة الإلكترونية.',
        );
      }
      if (!cardIntegrationId && method !== 'WALLET') {
        this.logger.error('Paymob card integration ID is missing');
        throw new BadRequestException(CARD_UNAVAILABLE_MESSAGE);
      }

      const integrationId =
        method === 'WALLET' && walletIntegrationId
          ? Number(walletIntegrationId)
          : Number(cardIntegrationId);

      // Get Auth Token
      const authRes: AxiosResponse<{ token: string }> = await firstValueFrom(
        this.httpService.post(`${this.BASE_URL}/api/auth/tokens`, {
          api_key: process.env.PAYMOB_API_KEY,
        }),
      );
      const token = String(authRes.data.token);

      // Register Order
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

      // Get Payment Key
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
            phone_number: walletPhone || user.phoneNumber || 'NA',
            shipping_method: 'NA',
            postal_code: 'NA',
            city: 'NA',
            country: 'EG',
            last_name: 'NA',
            state: 'NA',
          },
          currency: 'EGP',
          integration_id: integrationId,
        }),
      );
      const paymentToken = String(keyRes.data.token);

      // Mobile Wallet Pay Request
      if (method === 'WALLET') {
        try {
          const payRes: AxiosResponse<{
            redirect_url?: string;
            iframe_redirection_url?: string;
            iframe_redirection_token?: string;
            data?: { message?: string; txn_response_code?: string };
          }> = await firstValueFrom(
            this.httpService.post(
              `${this.BASE_URL}/api/acceptance/payments/pay`,
              {
                payment_token: paymentToken,
                source: {
                  identifier: this.normalizeEgyptianPhone(walletPhone!),
                  subtype: 'WALLET',
                },
              },
            ),
          );

          const walletRedirectUrl =
            payRes.data?.redirect_url || payRes.data?.iframe_redirection_url;
          if (walletRedirectUrl) {
            return {
              checkoutUrl: walletRedirectUrl,
              providerOrderId: String(orderId),
            };
          }
          if (payRes.data?.iframe_redirection_token) {
            const walletIframeId = process.env.PAYMOB_WALLET_IFRAME_ID;
            if (!walletIframeId) {
              this.logger.error(
                'Paymob returned a wallet iframe token but PAYMOB_WALLET_IFRAME_ID is missing',
              );
              throw new BadRequestException(WALLET_UNAVAILABLE_MESSAGE);
            }
            return {
              checkoutUrl: `${this.BASE_URL}/api/acceptance/iframes/${walletIframeId}?payment_token=${payRes.data.iframe_redirection_token}`,
              providerOrderId: String(orderId),
            };
          }
          const providerMessage = payRes.data?.data?.message;
          this.logger.warn(
            `Paymob wallet checkout returned no redirect URL${providerMessage ? `: ${providerMessage}` : ''}`,
          );
          if (providerMessage?.toLowerCase() === 'receiver is not registered') {
            throw new BadRequestException(
              'رقم الهاتف غير مسجل كمحفظة إلكترونية. في وضع الاختبار استخدم رقم محفظة Paymob التجريبي 01010101010.',
            );
          }
          throw new BadRequestException(
            'تعذر تجهيز محفظة الدفع الإلكترونية لدى Paymob. تحقق من رقم المحفظة ثم حاول مرة أخرى.',
          );
        } catch (walletPayError) {
          if (walletPayError instanceof BadRequestException) {
            throw walletPayError;
          }
          const axiosError = walletPayError as AxiosError;
          this.logger.error(
            'Direct Paymob wallet pay error:',
            axiosError.response?.data || axiosError.message,
          );
          throw new BadRequestException(WALLET_UNAVAILABLE_MESSAGE);
        }
      }

      const iframeId = process.env.PAYMOB_IFRAME_ID;
      if (!iframeId) {
        this.logger.error('PAYMOB_IFRAME_ID is missing');
        throw new BadRequestException(CARD_UNAVAILABLE_MESSAGE);
      }

      return {
        checkoutUrl: `${this.BASE_URL}/api/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`,
        providerOrderId: String(orderId),
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const axiosError = error as AxiosError;
      const errorData = axiosError.response?.data
        ? JSON.stringify(axiosError.response.data)
        : '';
      this.logger.error(
        'Paymob Checkout Error:',
        errorData || axiosError.message || axiosError,
      );
      throw new BadRequestException(
        'تعذر بدء عملية الدفع حالياً. حاول مرة أخرى لاحقاً.',
      );
    }
  }

  private normalizeEgyptianPhone(phone: string): string {
    const compact = phone.replace(/[\s-]/g, '');
    if (compact.startsWith('+20')) return `0${compact.slice(3)}`;
    if (compact.startsWith('0020')) return `0${compact.slice(4)}`;
    return compact;
  }

  processWebhook(
    query: Record<string, string>,
    body: Record<string, unknown>,
  ): WebhookResult {
    if (!this.HMAC_SECRET?.trim()) {
      this.logger.error('PAYMOB_HMAC_SECRET is missing; rejecting webhook');
      return {
        success: false,
        isFinal: false,
        isValid: false,
        transactionId: '',
      };
    }

    const obj = body?.obj as PaymobWebhookTransaction | undefined;
    if (!obj) {
      return {
        success: false,
        isFinal: false,
        isValid: false,
        transactionId: '',
      };
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
      return {
        isValid: false,
        success: false,
        isFinal: false,
        transactionId: '',
      };
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
      amountCents: Number(obj.amount_cents),
      currency: String(obj.currency || ''),
    };
  }

  async checkTransactionStatus(
    providerOrderId: string,
  ): Promise<{ isSuccessful: boolean; transactionId?: string }> {
    try {
      const response: AxiosResponse<{ token: string }> = await firstValueFrom(
        this.httpService.post('https://accept.paymob.com/api/auth/tokens', {
          api_key: process.env.PAYMOB_API_KEY,
        }),
      );
      const token = String(response.data.token);

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
