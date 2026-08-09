import {
  BILLABLE_PAYMENT_TYPES,
  FREE_ACTIVE_LISTING_LIMIT,
  isBillablePaymentType,
  PREMIUM_ACTIVE_LISTING_LIMIT,
  PREMIUM_INCLUDED_AI_USES,
  OWNER_PLUS_ACTIVE_LISTING_LIMIT,
  OWNER_PLUS_INCLUDED_AI_USES,
  OWNER_PLUS_OFFERS_MONTHLY_ALLOTMENT,
  PREMIUM_OFFERS_MONTHLY_ALLOTMENT,
  PLAN_BOOST_DURATION_DAYS,
  PRICING_CATALOG,
} from './pricing.catalog';

describe('revised broker-free pricing catalog', () => {
  it('exposes the approved checkout products at catalog prices', () => {
    expect(BILLABLE_PAYMENT_TYPES).toEqual([
      'OWNER_PLUS_MONTHLY',
      'OWNER_PLUS_YEARLY',
      'PREMIUM_MONTHLY',
      'PREMIUM_YEARLY',
      'EXTRA_LISTING_60D',
      'OFFERS_10_60D',
      'BOOST_7D',
      'BOOST_14D',
      'BOOST_30D',
      'AI_USES_10_90D',
    ]);
    expect(
      Object.fromEntries(
        Object.entries(PRICING_CATALOG).map(([key, value]) => [
          key,
          value.priceEgp,
        ]),
      ),
    ).toEqual({
      OWNER_PLUS_MONTHLY: 299,
      OWNER_PLUS_YEARLY: 2990,
      PREMIUM_MONTHLY: 699,
      PREMIUM_YEARLY: 6990,
      EXTRA_LISTING_60D: 99,
      OFFERS_10_60D: 49,
      BOOST_7D: 79,
      BOOST_14D: 149,
      BOOST_30D: 249,
      AI_USES_10_90D: 39,
    });
  });

  it('does not allow removed or historical products at checkout', () => {
    expect(isBillablePaymentType('NEW_LISTING')).toBe(false);
    expect(isBillablePaymentType('REFILL_MATCHES')).toBe(false);
    expect(isBillablePaymentType('OFFER_PACK')).toBe(false);
    expect(isBillablePaymentType('BROKER_SOLO')).toBe(false);
    expect(isBillablePaymentType('DOCS_PACK')).toBe(false);
  });

  it('records the explicit launch entitlement defaults', () => {
    expect(FREE_ACTIVE_LISTING_LIMIT).toBe(1);
    expect(OWNER_PLUS_ACTIVE_LISTING_LIMIT).toBe(3);
    expect(PREMIUM_ACTIVE_LISTING_LIMIT).toBe(10);
    expect(OWNER_PLUS_INCLUDED_AI_USES).toBe(10);
    expect(PREMIUM_INCLUDED_AI_USES).toBe(30);
    expect(OWNER_PLUS_OFFERS_MONTHLY_ALLOTMENT).toBe(30);
    expect(PREMIUM_OFFERS_MONTHLY_ALLOTMENT).toBe(100);
    expect(PLAN_BOOST_DURATION_DAYS).toBe(7);
  });
});
