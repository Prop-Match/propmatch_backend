import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { MAIL_QUEUE, SEND_MAIL_JOB, type MailJobData } from './mail.constants';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @InjectQueue(MAIL_QUEUE) private readonly queue: Queue<MailJobData>,
  ) {}

  private async enqueue(data: MailJobData): Promise<void> {
    try {
      await this.queue.add(SEND_MAIL_JOB, data);
    } catch (error) {
      // Moderation state is authoritative. A Redis outage must not make a
      // completed admin decision look as if it failed or alter websocket flow.
      this.logger.error(
        `Failed to enqueue ${data.kind} email`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  sendPasswordResetEmail(to: string, token: string) {
    return this.enqueue({ kind: 'PASSWORD_RESET', to, token });
  }

  sendKycReviewEmail(
    input: Omit<Extract<MailJobData, { kind: 'KYC_REVIEW' }>, 'kind'>,
  ) {
    return this.enqueue({ kind: 'KYC_REVIEW', ...input });
  }

  sendPropertyReviewEmail(
    input: Omit<Extract<MailJobData, { kind: 'PROPERTY_REVIEW' }>, 'kind'>,
  ) {
    return this.enqueue({ kind: 'PROPERTY_REVIEW', ...input });
  }

  sendTenantRequestReviewEmail(
    input: Omit<
      Extract<MailJobData, { kind: 'TENANT_REQUEST_REVIEW' }>,
      'kind'
    >,
  ) {
    return this.enqueue({ kind: 'TENANT_REQUEST_REVIEW', ...input });
  }

  sendUserReviewDecisionEmail(
    input: Omit<Extract<MailJobData, { kind: 'USER_REVIEW_DECISION' }>, 'kind'>,
  ) {
    return this.enqueue({ kind: 'USER_REVIEW_DECISION', ...input });
  }

  sendAccountSuspendedEmail(
    input: Omit<Extract<MailJobData, { kind: 'ACCOUNT_SUSPENDED' }>, 'kind'>,
  ) {
    return this.enqueue({ kind: 'ACCOUNT_SUSPENDED', ...input });
  }

  sendAccountUnsuspendedEmail(
    input: Omit<Extract<MailJobData, { kind: 'ACCOUNT_UNSUSPENDED' }>, 'kind'>,
  ) {
    return this.enqueue({ kind: 'ACCOUNT_UNSUSPENDED', ...input });
  }

  sendAccountDeletedEmail(
    input: Omit<Extract<MailJobData, { kind: 'ACCOUNT_DELETED' }>, 'kind'>,
  ) {
    return this.enqueue({ kind: 'ACCOUNT_DELETED', ...input });
  }

  sendAccountReactivatedEmail(to: string, name = 'مستخدم PropMatch') {
    return this.enqueue({ kind: 'ACCOUNT_REACTIVATED', to, name });
  }

  sendAccountReactivationRejectedEmail(to: string, name = 'مستخدم PropMatch') {
    return this.enqueue({ kind: 'ACCOUNT_REACTIVATION_REJECTED', to, name });
  }

  sendSupportReplyEmail(
    input: Omit<Extract<MailJobData, { kind: 'SUPPORT_REPLY' }>, 'kind'>,
  ) {
    return this.enqueue({ kind: 'SUPPORT_REPLY', ...input });
  }

  sendAdminWelcomeEmail(
    input: Omit<Extract<MailJobData, { kind: 'ADMIN_WELCOME' }>, 'kind'>,
  ) {
    return this.enqueue({ kind: 'ADMIN_WELCOME', ...input });
  }

  sendAdminAccountUpdatedEmail(
    input: Omit<
      Extract<MailJobData, { kind: 'ADMIN_ACCOUNT_UPDATED' }>,
      'kind'
    >,
  ) {
    return this.enqueue({ kind: 'ADMIN_ACCOUNT_UPDATED', ...input });
  }
}
