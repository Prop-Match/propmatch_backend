export interface PaymobCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}
export interface PaymobIntentionInput {
  amountCents: number;
  currency: string;
  paymentMethods: number[];
  specialReference: string;
  customer: PaymobCustomer;
  extras?: Record<string, string>;
}

export interface PaymobIntentionResponse {
  client_secret: string;
}

export interface PaymobOrderResponse {
  transactions: Array<{
    success?: boolean;
    is_voided?: boolean;
    is_refunded?: boolean;
    id?: string | number;
  }>;
}

export interface PaymobSourceData {
  pan: string;
  sub_type: string;
  type: string;
}

export interface PaymobOrderData {
  id: number;
}

export interface PaymobWebhookTransaction {
  amount_cents: number;
  created_at: number;
  currency: string;
  error_occured: boolean;
  has_parent_transaction: boolean;
  id: number;
  integration_id: number;
  is_3d_secure: boolean;
  is_auth: boolean;
  is_capture: boolean;
  is_refunded: boolean;
  is_standalone_payment: boolean;
  is_voided: boolean;
  order: PaymobOrderData & {
    data?: {
      paymentType?: string;
      userId?: string;
    };
  };
  owner: number;
  pending: boolean;
  source_data: PaymobSourceData;
  success: boolean;
  payment_key_claims?: {
    extra?: {
      userId?: string;
      paymentType?: string;
    };
  };
}
