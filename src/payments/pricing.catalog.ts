export const PRICING_CATALOG = {
  PREMIUM_OWNER: {
    priceEgp: 999,
    billing: 'MONTHLY',
    allowedRoles: ['LANDLORD'],
  },
  BOOST_LISTING: {
    priceEgp: 349,
    billing: 'ONE_TIME',
    allowedRoles: ['LANDLORD'],
  },
  AI_ADDON: {
    priceEgp: 199,
    billing: 'ONE_TIME',
    allowedRoles: ['LANDLORD'],
  },
} as const;

export type BillablePaymentType = keyof typeof PRICING_CATALOG;

export const BILLABLE_PAYMENT_TYPES = Object.keys(
  PRICING_CATALOG,
) as BillablePaymentType[];

export function isBillablePaymentType(
  value: string,
): value is BillablePaymentType {
  return BILLABLE_PAYMENT_TYPES.includes(value as BillablePaymentType);
}

export const FREE_ACTIVE_LISTING_LIMIT = 1;
export const PREMIUM_ACTIVE_LISTING_LIMIT = 5;
export const PREMIUM_INCLUDED_AI_USES = 5;
export const BOOST_DURATION_DAYS = 7;
