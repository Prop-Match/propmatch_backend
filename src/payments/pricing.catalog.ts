export const PRICING_CATALOG = {
  OWNER_PLUS_MONTHLY: {
    priceEgp: 299,
    billing: 'MONTHLY',
    kind: 'SUBSCRIPTION',
    planType: 'OWNER_PLUS',
    allowedRoles: ['LANDLORD'],
  },
  OWNER_PLUS_YEARLY: {
    priceEgp: 2_990,
    billing: 'YEARLY',
    kind: 'SUBSCRIPTION',
    planType: 'OWNER_PLUS',
    allowedRoles: ['LANDLORD'],
  },
  PREMIUM_MONTHLY: {
    priceEgp: 699,
    billing: 'MONTHLY',
    kind: 'SUBSCRIPTION',
    planType: 'PREMIUM',
    allowedRoles: ['LANDLORD'],
  },
  PREMIUM_YEARLY: {
    priceEgp: 6_990,
    billing: 'YEARLY',
    kind: 'SUBSCRIPTION',
    planType: 'PREMIUM',
    allowedRoles: ['LANDLORD'],
  },
  EXTRA_LISTING_60D: {
    priceEgp: 99,
    billing: 'ONE_TIME',
    kind: 'ENTITLEMENT',
    entitlementType: 'ACTIVE_LISTING',
    quantity: 1,
    validityDays: 60,
    allowedRoles: ['LANDLORD'],
  },
  OFFERS_10_60D: {
    priceEgp: 49,
    billing: 'ONE_TIME',
    kind: 'ENTITLEMENT',
    entitlementType: 'MATCHED_OFFER',
    quantity: 10,
    validityDays: 60,
    allowedRoles: ['LANDLORD'],
  },
  BOOST_7D: {
    priceEgp: 79,
    billing: 'ONE_TIME',
    kind: 'BOOST',
    durationDays: 7,
    allowedRoles: ['LANDLORD'],
  },
  BOOST_14D: {
    priceEgp: 149,
    billing: 'ONE_TIME',
    kind: 'BOOST',
    durationDays: 14,
    allowedRoles: ['LANDLORD'],
  },
  BOOST_30D: {
    priceEgp: 249,
    billing: 'ONE_TIME',
    kind: 'BOOST',
    durationDays: 30,
    allowedRoles: ['LANDLORD'],
  },
  AI_USES_10_90D: {
    priceEgp: 39,
    billing: 'ONE_TIME',
    kind: 'ENTITLEMENT',
    entitlementType: 'AI_OPTIMIZER_USE',
    quantity: 10,
    validityDays: 90,
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
export const PREMIUM_ACTIVE_LISTING_LIMIT = 10;

export const FREE_OFFERS_MONTHLY_ALLOTMENT = 5;
export const OWNER_PLUS_OFFERS_MONTHLY_ALLOTMENT = 30;
export const PREMIUM_OFFERS_MONTHLY_ALLOTMENT = 100;

export const FREE_AI_USES_MONTHLY_ALLOTMENT = 5;
export const OWNER_PLUS_INCLUDED_AI_USES = 10;
export const PREMIUM_INCLUDED_AI_USES = 30;

export const FREE_BOOST_CREDITS_MONTHLY = 0;
export const OWNER_PLUS_BOOST_CREDITS_MONTHLY = 1;
export const PREMIUM_BOOST_CREDITS_MONTHLY = 2;
export const PLAN_BOOST_DURATION_DAYS = 7;

export const LISTING_CAPACITY_GRACE_DAYS = 7;

export type OwnerPlanName = 'FREE' | 'OWNER_PLUS' | 'PREMIUM';

export function planAllowances(planType: OwnerPlanName) {
  if (planType === 'PREMIUM') {
    return {
      activeListings: PREMIUM_ACTIVE_LISTING_LIMIT,
      offers: PREMIUM_OFFERS_MONTHLY_ALLOTMENT,
      aiUses: PREMIUM_INCLUDED_AI_USES,
      boostCredits: PREMIUM_BOOST_CREDITS_MONTHLY,
    };
  }
  if (planType === 'OWNER_PLUS') {
    return {
      activeListings: OWNER_PLUS_ACTIVE_LISTING_LIMIT,
      offers: OWNER_PLUS_OFFERS_MONTHLY_ALLOTMENT,
      aiUses: OWNER_PLUS_INCLUDED_AI_USES,
      boostCredits: OWNER_PLUS_BOOST_CREDITS_MONTHLY,
    };
  }
  return {
    activeListings: FREE_ACTIVE_LISTING_LIMIT,
    offers: FREE_OFFERS_MONTHLY_ALLOTMENT,
    aiUses: FREE_AI_USES_MONTHLY_ALLOTMENT,
    boostCredits: FREE_BOOST_CREDITS_MONTHLY,
  };
}
