import { escapeHtml, renderMail } from './mail.template';
import type { MailJobData } from './mail.constants';

describe('mail templates', () => {
  it('escapes every HTML-sensitive dynamic value', () => {
    expect(escapeHtml(`<script>'"&</script>`)).toBe(
      '&lt;script&gt;&#39;&quot;&amp;&lt;/script&gt;',
    );
    const rendered = renderMail(
      {
        kind: 'PROPERTY_REVIEW',
        to: 'owner@example.com',
        name: '<Owner>',
        approved: false,
        propertyId: 'property-1',
        propertyTitle: '<script>alert(1)</script>',
        reason: '<img src=x onerror=alert(1)>',
      },
      'https://propmatch.example/',
    );
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it.each<MailJobData>([
    { kind: 'PASSWORD_RESET', to: 'user@example.com', token: 'secret' },
    {
      kind: 'KYC_REVIEW',
      to: 'user@example.com',
      name: 'User',
      approved: false,
      reason: 'Reason',
    },
    {
      kind: 'PROPERTY_REVIEW',
      to: 'user@example.com',
      name: 'User',
      approved: true,
      propertyId: 'property-1',
      propertyTitle: 'Home',
    },
    {
      kind: 'TENANT_REQUEST_REVIEW',
      to: 'user@example.com',
      name: 'User',
      approved: true,
    },
    {
      kind: 'USER_REVIEW_DECISION',
      to: 'user@example.com',
      name: 'User',
      approved: false,
      propertyId: 'property-1',
      reason: 'Reason',
    },
    {
      kind: 'ACCOUNT_SUSPENDED',
      to: 'user@example.com',
      name: 'User',
      reason: 'Spam',
    },
    { kind: 'ACCOUNT_UNSUSPENDED', to: 'user@example.com', name: 'User' },
    { kind: 'ACCOUNT_DELETED', to: 'user@example.com', name: 'User' },
    { kind: 'ACCOUNT_REACTIVATED', to: 'user@example.com', name: 'User' },
    {
      kind: 'ACCOUNT_REACTIVATION_REJECTED',
      to: 'user@example.com',
      name: 'User',
    },
    {
      kind: 'SUPPORT_REPLY',
      to: 'user@example.com',
      name: 'User',
      ticketId: 'ticket-1',
      preview: 'Reply',
    },
    {
      kind: 'ADMIN_WELCOME',
      to: 'admin@example.com',
      name: 'Admin',
      roleLabel: 'Support',
    },
    {
      kind: 'ADMIN_ACCOUNT_UPDATED',
      to: 'admin@example.com',
      name: 'Admin',
      roleLabel: 'Support',
      disabled: false,
    },
  ])('renders a subject and branded HTML for $kind', (job) => {
    const rendered = renderMail(job, 'https://propmatch.example');
    expect(rendered.subject).toContain('PropMatch');
    expect(rendered.html).toContain('PropMatch');
    expect(rendered.html).toContain('dir="rtl"');
  });

  it('uses the canonical frontend origin for links and logo assets', () => {
    const rendered = renderMail(
      { kind: 'PASSWORD_RESET', to: 'user@example.com', token: 'secret' },
      'https://propmatch.example/landlord/',
    );

    expect(rendered.html).toContain(
      'https://propmatch.example/reset-password?token=secret',
    );
    expect(rendered.html).toContain('src="https://propmatch.example/logo.png"');
  });
});
