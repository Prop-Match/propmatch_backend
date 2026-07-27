import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false, // true for 465, false for 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendPasswordResetEmail(email: string, rawToken: string): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    const htmlContent = `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; rounded: 8px;">
        <h2 style="color: #0d9488; text-align: center;">إعادة تعيين كلمة المرور - PropMatch</h2>
        <p>مرحباً،</p>
        <p>تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك على منصة <strong>PropMatch</strong>.</p>
        <p>يمكنك تغيير كلمة المرور بالنقر على الزر أدناه:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #0d9488; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            إعادة تعيين كلمة المرور
          </a>
        </div>
        <p style="font-size: 13px; color: #666;">أو يمكنك نسخ الرابط التالي ولصقه في متصفحك:</p>
        <p style="font-size: 12px; color: #0d9488; word-break: break-all;">${resetUrl}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا البريد بأمان.</p>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || '"PropMatch" <noreply@propmatch.com>',
        to: email,
        subject: 'إعادة تعيين كلمة المرور - PropMatch',
        html: htmlContent,
      });
      this.logger.log(`Password reset email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${email}`, error);
      // Fallback log for development
      console.log(`[MAIL FALLBACK LINK]: ${resetUrl}`);
    }
  }
}
