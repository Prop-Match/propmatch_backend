export const PRICING_CATALOG = {
  PREMIUM_OWNER: {
    priceEgp: 999,
    billing: 'MONTHLY',
    allowedRoles: ['LANDLORD'],
  },
  OWNER_PLUS: {
    priceEgp: 499,
    billing: 'MONTHLY',
    allowedRoles: ['LANDLORD'],
  },
  SINGLE_LISTING: {
    priceEgp: 149,
    billing: 'ONE_TIME',
    allowedRoles: ['LANDLORD'],
  },
  SINGLE_OFFER: {
    priceEgp: 99,
    billing: 'ONE_TIME',
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
export const OWNER_PLUS_ACTIVE_LISTING_LIMIT = 3;
export const PREMIUM_ACTIVE_LISTING_LIMIT = 5;
export const FREE_OFFERS_MONTHLY_ALLOTMENT = 5;
export const OWNER_PLUS_INCLUDED_AI_USES = 3;
export const PREMIUM_INCLUDED_AI_USES = 5;
export const AI_ADDON_USES = 10;
export const BOOST_DURATION_DAYS = 30;
