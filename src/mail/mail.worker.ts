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
  private readonly gmailUser?: string;
  private readonly gmailClientId?: string;
  private readonly gmailClientSecret?: string;
  private readonly gmailRefreshToken?: string;
  private gmailAccessToken?: string;
  private gmailTokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {
    super();
    this.resendApiKey = config.get<string>('RESEND_API_KEY')?.trim();
    this.gmailUser = config.get<string>('GMAIL_USER')?.trim();
    this.gmailClientId = config.get<string>('GMAIL_CLIENT_ID')?.trim();
    this.gmailClientSecret = config.get<string>('GMAIL_CLIENT_SECRET')?.trim();
    this.gmailRefreshToken = config.get<string>('GMAIL_REFRESH_TOKEN')?.trim();

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
    const hasGmailOAuth =
      Boolean(this.gmailUser &&
      this.gmailClientId &&
      this.gmailClientSecret &&
      this.gmailRefreshToken);
    if (
      !hasGmailOAuth &&
      !this.resendApiKey &&
      config.get<string>('NODE_ENV') === 'production' &&
      (!user || !pass)
    ) {
      throw new Error(
        'Either GMAIL OAuth credentials, RESEND_API_KEY, or (SMTP_USER and SMTP_PASS) is required in production.',
      );
    }
    this.frontendUrl =
      config.get<string>('FRONTEND_URL')?.trim() ||
      'https://propmatch-frontend.vercel.app';
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

  private async getGmailAccessToken(): Promise<string> {
    if (this.gmailAccessToken && Date.now() < this.gmailTokenExpiresAt - 60_000) {
      return this.gmailAccessToken;
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.gmailClientId!,
        client_secret: this.gmailClientSecret!,
        refresh_token: this.gmailRefreshToken!,
        grant_type: 'refresh_token',
      }),
    });

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!res.ok || !data.access_token) {
      throw new Error(
        `Failed to refresh Gmail OAuth token: ${data.error_description || data.error || res.statusText}`,
      );
    }

    this.gmailAccessToken = data.access_token;
    this.gmailTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    return this.gmailAccessToken;
  }

  private async sendViaGmailApi(to: string, subject: string, html: string): Promise<void> {
    const accessToken = await this.getGmailAccessToken();
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `From: PropMatch <${this.gmailUser}>`,
      `To: ${to}`,
      `Subject: ${utf8Subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
    ];
    const raw = Buffer.from(messageParts.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Gmail API delivery failed (status ${response.status}): ${errorText}`,
      );
    }
  }

  async process(job: Job<MailJobData>): Promise<void> {
    if (job.name !== SEND_MAIL_JOB) return;
    const rendered = renderMail(job.data, this.frontendUrl);

    if (
      this.gmailUser &&
      this.gmailClientId &&
      this.gmailClientSecret &&
      this.gmailRefreshToken
    ) {
      await this.sendViaGmailApi(job.data.to, rendered.subject, rendered.html);
      this.logger.log(
        `Delivered ${job.data.kind} email to ${job.data.to} via Gmail API (job ${job.id ?? 'unknown'})`,
      );
      return;
    }

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
      `Skipped ${job.data.kind} email delivery to ${job.data.to}: neither Gmail OAuth, RESEND_API_KEY, nor SMTP credentials configured.`,
    );
  }
}
