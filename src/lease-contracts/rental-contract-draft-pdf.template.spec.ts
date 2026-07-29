import { buildRentalContractDraftPdfHtml } from './rental-contract-draft-pdf.template';

describe('buildRentalContractDraftPdfHtml', () => {
  it('renders Arabic RTL draft content while escaping dynamic values', () => {
    const html = buildRentalContractDraftPdfHtml({
      contractId: 'contract-1', ownerName: '<img src=x>', tenantName: 'مستأجر',
      propertyAddress: 'القاهرة', rentAmount: 12000,
      startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2027-07-31T00:00:00Z'),
      customClauses: ['<script>alert(1)</script>'], generatedAt: new Date('2026-07-28T00:00:00Z'),
    });
    expect(html).toContain('مسودة عقد إيجار');
    expect(html).toContain('هذه مسودة عقد إيجار للمراجعة فقط');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('رقم قومي');
  });
});
