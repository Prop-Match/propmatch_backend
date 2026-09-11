import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { MAIL_QUEUE, SEND_MAIL_JOB, type MailJobData } from './mail.constants';
import { renderMail } from './mail.template';

@Processor(MAIL_QUEUE, { concurrency: 5 })
export class MailWorker extends WorkerHost {
  private readonly logger = new Logger(MailWorker.name);
  private readonly transporter?: nodemailer.Transporter;
  private readonly frontendUrl: string;
  private readonly from: string;
  private readonly resendApiKey?: string;
  private readonly resendFrom: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.resendApiKey = config.get<string>('RESEND_API_KEY')?.trim();

    const port = Number(config.get<string>('SMTP_PORT') || 587);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error('SMTP_PORT must be a positive integer.');
    }
    const user = config.get<string>('SMTP_USER')?.trim();
    const pass = config.get<string>('SMTP_PASS')?.trim();
    const host = config.get<string>('SMTP_HOST')?.trim() || 'smtp.gmail.com';
    const secureSetting = config.get<string>('SMTP_SECURE')?.trim();
    if (
      secureSetting &&
      !['true', 'false'].includes(secureSetting.toLowerCase())
    ) {
      throw new Error('SMTP_SECURE must be true or false.');
    }
    const secure = secureSetting
      ? secureSetting.toLowerCase() === 'true'
      : port === 465;
    if ((user && !pass) || (!user && pass)) {
      throw new Error('SMTP_USER and SMTP_PASS must be configured together.');
    }
    if (
      !this.resendApiKey &&
      config.get<string>('NODE_ENV') === 'production' &&
      (!user || !pass)
    ) {
      throw new Error(
        'Either RESEND_API_KEY or (SMTP_USER and SMTP_PASS) is required in production.',
      );
    }
    this.frontendUrl =
      config.get<string>('FRONTEND_URL')?.trim() || 'http://localhost:3000';
    const frontend = new URL(this.frontendUrl);
    if (!['http:', 'https:'].includes(frontend.protocol)) {
      throw new Error('FRONTEND_URL must use http or https.');
    }
    this.from =
      config.get<string>('SMTP_FROM')?.trim() ||
      '"PropMatch" <noreply@propmatch.com>';
    this.resendFrom =
      config.get<string>('RESEND_FROM')?.trim() ||
      'PropMatch <onboarding@resend.dev>';

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });
    }
  }

  async process(job: Job<MailJobData>): Promise<void> {
    if (job.name !== SEND_MAIL_JOB) return;
    const rendered = renderMail(job.data, this.frontendUrl);

    if (this.resendApiKey) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.resendFrom,
          to: [job.data.to],
          subject: rendered.subject,
          html: rendered.html,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Resend API delivery failed (status ${response.status}): ${errorText}`,
        );
      }

      this.logger.log(
        `Delivered ${job.data.kind} email to ${job.data.to} via Resend (job ${job.id ?? 'unknown'})`,
      );
      return;
    }

    if (this.transporter) {
      await this.transporter.sendMail({
        from: this.from,
        to: job.data.to,
        subject: rendered.subject,
        html: rendered.html,
      });
      this.logger.log(
        `Delivered ${job.data.kind} email to ${job.data.to} via SMTP (job ${job.id ?? 'unknown'})`,
      );
      return;
    }

    this.logger.warn(
      `Skipped ${job.data.kind} email delivery to ${job.data.to}: neither RESEND_API_KEY nor SMTP credentials configured.`,
    );
  }
}
