import {
  buildSemanticMatchReasons,
  detectFurnishingPreference,
  MAX_SEMANTIC_MATCH_REASONS,
} from './semantic-match-reasons';

describe('buildSemanticMatchReasons', () => {
  const property = {
    city: { nameAr: 'المنصورة', nameEn: 'Mansoura' },
    district: 'University District',
    propertyType: 'APARTMENT' as const,
    bedrooms: 2,
    isFurnished: true,
  };

  it('returns Arabic, typed reasons in stable priority order and caps them', () => {
    const reasons = buildSemanticMatchReasons(
      'furnished 2 bedrooms apartment in Mansoura',
      property,
    );

    expect(reasons).toEqual([
      expect.objectContaining({ code: 'LOCATION_MENTION_MATCH' }),
      expect.objectContaining({ code: 'PROPERTY_TYPE_MENTION_MATCH' }),
      expect.objectContaining({ code: 'BEDROOM_MENTION_MATCH' }),
    ]);
    expect(reasons).toHaveLength(MAX_SEMANTIC_MATCH_REASONS);
    expect(
      reasons.every(
        ({ code, text }) => Boolean(code) && /[\u0600-\u06ff]/.test(text),
      ),
    ).toBe(true);
  });

  it('always gives an above-threshold semantic result the general intent reason', () => {
    expect(
      buildSemanticMatchReasons('quiet place near campus', property),
    ).toEqual([
      {
        code: 'MATCHES_SEARCH_INTENT',
        text: 'يتوافق مع تفاصيل البحث والتفضيلات المكتوبة',
      },
    ]);
  });

  it.each([
    ['2 bedrooms', 1],
    ['غرفتين', 1],
    ['٢ غرف', 1],
    ['ثلاث غرف', 2],
  ])('does not claim bedrooms when %s is not satisfied', (query, bedrooms) => {
    const reasons = buildSemanticMatchReasons(query, { ...property, bedrooms });
    expect(reasons.map(({ code }) => code)).not.toContain(
      'BEDROOM_MENTION_MATCH',
    );
  });

  it('adds furnishing only for a furnished property when the query requests it', () => {
    expect(
      buildSemanticMatchReasons('مفروش', property).map(({ code }) => code),
    ).toContain('FURNISHING_MENTION_MATCH');
    expect(
      buildSemanticMatchReasons('مفروش', {
        ...property,
        isFurnished: false,
      }).map(({ code }) => code),
    ).not.toContain('FURNISHING_MENTION_MATCH');
  });

  it.each(['unfurnished apartment', 'not furnished', 'غير مفروش'])(
    'does not mistake "%s" for a furnished request',
    (query) => {
      expect(
        buildSemanticMatchReasons(query, property).map(({ code }) => code),
      ).not.toContain('FURNISHING_MENTION_MATCH');
    },
  );

  it.each([
    ['furnished apartment', true],
    ['شقة مفروشة', true],
    ['unfurnished apartment', false],
    ['شقة غير مفروش', false],
    ['apartment in Mansoura', undefined],
  ])('detects furnishing preference for %s', (query, expected) => {
    expect(detectFurnishingPreference(query)).toBe(expected);
  });

  it('adds location and property type only for actual query mentions', () => {
    expect(
      buildSemanticMatchReasons('villa in Cairo', property).map(
        ({ code }) => code,
      ),
    ).not.toEqual(
      expect.arrayContaining([
        'LOCATION_MENTION_MATCH',
        'PROPERTY_TYPE_MENTION_MATCH',
      ]),
    );
    expect(
      buildSemanticMatchReasons('شقة في المنصورة', property).map(
        ({ code }) => code,
      ),
    ).toEqual(
      expect.arrayContaining([
        'LOCATION_MENTION_MATCH',
        'PROPERTY_TYPE_MENTION_MATCH',
      ]),
    );
  });

  it('never produces exaggerated or exact-distance language', () => {
    const text = buildSemanticMatchReasons(
      'furnished 2 bedrooms apartment in Mansoura',
      property,
    )
      .map(({ text }) => text)
      .join(' ')
      .toLowerCase();

    expect(text).not.toMatch(
      /perfect|guaranteed|مضمون|مثالي|100%|minute|دقيقة/,
    );
  });
});
