import { Property, TenantRequest } from 'generated/prisma/client';
import { scoreRequestAgainstProperty } from './matching.service';

/**
 * The match score is ported verbatim from the frontend mock. These tests pin
 * its behaviour: bounded 5–98, deterministic, and moving in the right
 * direction as a property fits the request better or worse. Pure function —
 * no DB, so it runs even while other modules are mid-change.
 */

const request = (over: Partial<TenantRequest> = {}): TenantRequest =>
  ({
    id: 'r',
    tenantId: 't',
    minBudget: 3000,
    maxBudget: 5000,
    preferredLocations: 'توريل',
    propertyType: 'APARTMENT',
    requiredBedrooms: 2,
    needsFurnished: false,
    flexibilityScore: 5,
    lifestyleRequirements: 'شقة هادئة قريبة من الجامعة',
    status: 'APPROVED',
    approvedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as TenantRequest;

const property = (over: Partial<Property> = {}): Property =>
  ({
    id: 'p',
    ownerId: 'o',
    title: 'شقة',
    description: 'شقة هادئة قريبة من الجامعة',
    governorate: 'الدقهلية',
    city: 'المنصورة',
    district: 'توريل',
    manualAddress: 'x',
    propertyType: 'APARTMENT',
    propertyAroundServices: null,
    rentAmount: 4000,
    areaM2: 100,
    bedrooms: 3,
    bathrooms: 1,
    isFurnished: false,
    hasElevator: true,
    hasParking: false,
    contactRevealed: false,
    status: 'APPROVED',
    isBoosted: false,
    approvedBy: null,
    approvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as Property;

describe('scoreRequestAgainstProperty', () => {
  it('scores a strong all-round match near the ceiling', () => {
    expect(scoreRequestAgainstProperty(request(), property())).toBeGreaterThanOrEqual(90);
  });

  it('never leaves the 5–98 band', () => {
    const worst = property({ rentAmount: 99999, district: 'مكان آخر', propertyType: 'VILLA', bedrooms: 0 });
    const best = property();
    for (const p of [worst, best]) {
      const s = scoreRequestAgainstProperty(request(), p);
      expect(s).toBeGreaterThanOrEqual(5);
      expect(s).toBeLessThanOrEqual(98);
    }
  });

  it('rewards a property inside the budget over one outside it', () => {
    const inBudget = scoreRequestAgainstProperty(request(), property({ rentAmount: 4000 }));
    const overBudget = scoreRequestAgainstProperty(request(), property({ rentAmount: 9000 }));
    // +18 vs −22 on the budget term = a 40-point swing.
    expect(inBudget).toBeGreaterThan(overBudget);
  });

  it('is deterministic', () => {
    const r = request();
    const p = property();
    expect(scoreRequestAgainstProperty(r, p)).toBe(scoreRequestAgainstProperty(r, p));
  });

  it('reproduces the frontend number for a known case (parity)', () => {
    // Same inputs the frontend mock would clamp to 98:
    // 50 +18(budget) +12(loc) +8(type) +5(beds) +5(furnished) +4(lifestyle) = 102 → 98.
    expect(scoreRequestAgainstProperty(request(), property())).toBe(98);
  });
});
