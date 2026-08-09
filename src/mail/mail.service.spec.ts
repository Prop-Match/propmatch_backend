import type { Queue } from 'bullmq';
import { SEND_MAIL_JOB } from './mail.constants';
import { MailService } from './mail.service';

describe('MailService', () => {
  const add = jest.fn();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const service = new MailService({ add } as unknown as Queue);

  beforeEach(() => {
    jest.clearAllMocks();
    add.mockResolvedValue({ id: 'mail-1' });
  });

  it('enqueues mail instead of performing SMTP on the request path', async () => {
    await service.sendKycReviewEmail({
      to: 'user@example.com',
      name: 'User',
      approved: false,
      reason: 'صورة غير واضحة',
    });
    expect(add).toHaveBeenCalledWith(SEND_MAIL_JOB, {
      kind: 'KYC_REVIEW',
      to: 'user@example.com',
      name: 'User',
      approved: false,
      reason: 'صورة غير واضحة',
    });
  });

  it('does not fail a completed domain action when Redis is unavailable', async () => {
    add.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(
      service.sendAccountDeletedEmail({
        to: 'user@example.com',
        name: 'User',
      }),
    ).resolves.toBeUndefined();
  });
});
