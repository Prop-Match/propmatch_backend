export interface WebhookResult {
  isValid: boolean;
  success: boolean;
  transactionId: string;
  paymentType?: string;
  userId?: string;
  providerOrderId?: string;
}
export interface IPaymentGateway {
  generatePaymentUrl(
    userId: string,
    paymentType: string,
    amount: number,
  ): Promise<{ checkoutUrl: string; providerOrderId: string }>;
  processWebhook(
    query: Record<string, string>,
    body: Record<string, unknown>,
  ): WebhookResult;
  checkTransactionStatus(providerOrderId: string): Promise<{
    isSuccessful: boolean;
    transactionId?: string;
  }>;
}
