import {
  BILLABLE_PAYMENT_TYPES,
  BOOST_DURATION_DAYS,
  FREE_ACTIVE_LISTING_LIMIT,
  isBillablePaymentType,
  PREMIUM_ACTIVE_LISTING_LIMIT,
  PREMIUM_INCLUDED_AI_USES,
  PRICING_CATALOG,
} from './pricing.catalog';

describe('revised broker-free pricing catalog', () => {
  it('exposes the approved checkout products at catalog prices', () => {
    expect(BILLABLE_PAYMENT_TYPES).toEqual([
      'PREMIUM_OWNER',
      'OWNER_PLUS',
      'SINGLE_LISTING',
      'SINGLE_OFFER',
      'BOOST_LISTING',
      'AI_ADDON',
    ]);
    expect(
      Object.fromEntries(
        Object.entries(PRICING_CATALOG).map(([key, value]) => [
          key,
          value.priceEgp,
        ]),
      ),
    ).toEqual({
      PREMIUM_OWNER: 999,
      OWNER_PLUS: 499,
      SINGLE_LISTING: 149,
      SINGLE_OFFER: 99,
      BOOST_LISTING: 349,
      AI_ADDON: 199,
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
    expect(PREMIUM_ACTIVE_LISTING_LIMIT).toBe(5);
    expect(PREMIUM_INCLUDED_AI_USES).toBe(5);
    expect(BOOST_DURATION_DAYS).toBe(30);
  });
});
