import type { MailJobData } from './mail.constants';

export interface RenderedMail {
  subject: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character];
  });
}

function actionButton(label: string, url: string): string {
  return `<div style="text-align:center;margin:32px 0"><a href="${escapeHtml(url)}" target="_blank" style="background:#0d9488;color:#fff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;display:inline-block;box-shadow:0 4px 6px -1px rgba(13,148,136,.25)">${escapeHtml(label)}</a></div>`;
}

function layout(
  title: string,
  name: string,
  body: string,
  baseUrl: string,
): string {
  const escapedTitle = escapeHtml(title);
  const logoUrl = `${baseUrl}/logo.png`;
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapedTitle} - PropMatch</title></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;-webkit-font-smoothing:antialiased;direction:rtl;text-align:right"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:40px 15px"><tr><td align="center"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 15px -3px rgba(0,0,0,.05),0 4px 6px -2px rgba(0,0,0,.025)"><tr><td style="background:#0f766e;padding:24px 32px;text-align:center"><a href="${escapeHtml(baseUrl)}" target="_blank" style="text-decoration:none;display:inline-block"><img src="${escapeHtml(logoUrl)}" alt="PropMatch Logo" height="42" style="height:42px;width:auto;display:block;margin:0 auto;border:0"></a></td></tr><tr><td style="padding:36px 32px;background:#fff"><h1 style="margin:0 0 20px;color:#0f172a;font-size:22px;font-weight:700;text-align:center">${escapedTitle} - PropMatch</h1><div style="color:#334155;font-size:15px;line-height:1.7"><p style="margin-top:0">مرحباً ${escapeHtml(name)}،</p>${body}</div></td></tr><tr><td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #f1f5f9;text-align:center"><p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#0f766e">منصة PropMatch العقارية الذكية</p><p style="margin:0;font-size:12px;color:#94a3b8">هذه رسالة آلية من منصة PropMatch.</p></td></tr></table></td></tr></table></body></html>`;
}

function reasonParagraph(reason?: string): string {
  return reason ? `<p><strong>السبب:</strong> ${escapeHtml(reason)}</p>` : '';
}

function resolveFrontendBaseUrl(frontendUrl: string): string {
  const fallback = 'http://localhost:3000';
  const raw = frontendUrl.trim() || fallback;
  return raw.replace(/\/+$/, '').replace(/\/landlord\/?$/, '');
}

export function renderMail(
  job: MailJobData,
  frontendUrl: string,
): RenderedMail {
  const baseUrl = resolveFrontendBaseUrl(frontendUrl);
  switch (job.kind) {
    case 'PASSWORD_RESET': {
      const url = `${baseUrl}/reset-password?token=${encodeURIComponent(job.token)}`;
      return {
        subject: 'إعادة تعيين كلمة المرور - PropMatch',
        html: layout(
          'إعادة تعيين كلمة المرور',
          'مستخدم PropMatch',
          `<p>تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك.</p>${actionButton('إعادة تعيين كلمة المرور', url)}<p style="font-size:13px;color:#64748b;margin-bottom:6px">أو يمكنك نسخ الرابط التالي ولصقه في متصفحك مباشرة:</p><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;font-size:12px;color:#0d9488;word-break:break-all;font-family:monospace;direction:ltr;text-align:left">${escapeHtml(url)}</div><p style="font-size:12px;color:#94a3b8;text-align:center">إذا لم تطلب ذلك، يمكنك تجاهل الرسالة.</p>`,
          baseUrl,
        ),
      };
    }
    case 'KYC_REVIEW':
      return job.approved
        ? {
            subject: 'تم قبول توثيق الهوية - PropMatch',
            html: layout(
              'تم قبول توثيق الهوية',
              job.name,
              `<p>تمت الموافقة على توثيق هويتك بنجاح.</p>${actionButton('عرض الملف الشخصي', `${baseUrl}/profile`)}`,
              baseUrl,
            ),
          }
        : {
            subject: 'مطلوب إعادة تقديم مستندات التوثيق - PropMatch',
            html: layout(
              'مطلوب تصحيح مستندات التوثيق',
              job.name,
              `<p>راجع فريقنا طلب توثيق هويتك، ونحتاج منك تصحيح المستندات وإعادة تقديمها.</p>${reasonParagraph(job.reason)}${actionButton('إعادة تقديم المستندات', `${baseUrl}/verify`)}`,
              baseUrl,
            ),
          };
    case 'PROPERTY_REVIEW':
      return {
        subject: `${job.approved ? 'تم قبول' : 'تم رفض'} إعلان العقار - PropMatch`,
        html: layout(
          job.approved ? 'تم قبول إعلان العقار' : 'تم رفض إعلان العقار',
          job.name,
          `<p>${job.approved ? 'تمت الموافقة على نشر' : 'لم نتمكن من الموافقة على'} عقارك «${escapeHtml(job.propertyTitle)}».</p>${reasonParagraph(job.reason)}${actionButton('عرض العقار', `${baseUrl}/landlord/properties/${encodeURIComponent(job.propertyId)}`)}`,
          baseUrl,
        ),
      };
    case 'TENANT_REQUEST_REVIEW':
      return {
        subject: `${job.approved ? 'تم قبول' : 'تم رفض'} طلب السكن - PropMatch`,
        html: layout(
          job.approved ? 'تم قبول طلب السكن' : 'تم رفض طلب السكن',
          job.name,
          `<p>${job.approved ? 'تمت الموافقة على طلب السكن الخاص بك وأصبح جاهزاً للمطابقة.' : 'لم نتمكن من الموافقة على طلب السكن الخاص بك.'}</p>${reasonParagraph(job.reason)}${actionButton('عرض طلباتي', `${baseUrl}/tenant/requests`)}`,
          baseUrl,
        ),
      };
    case 'USER_REVIEW_DECISION':
      return {
        subject: `${job.approved ? 'تم نشر' : 'تم رفض'} تقييمك - PropMatch`,
        html: layout(
          job.approved ? 'تم نشر تقييمك' : 'تم رفض تقييمك',
          job.name,
          `<p>${job.approved ? 'تمت الموافقة على تقييمك ونشره.' : 'لم نتمكن من نشر تقييمك.'}</p>${reasonParagraph(job.reason)}${actionButton('العودة إلى PropMatch', baseUrl)}`,
          baseUrl,
        ),
      };
    case 'ACCOUNT_SUSPENDED': {
      const duration = job.suspendedUntil
        ? `حتى ${escapeHtml(new Date(job.suspendedUntil).toLocaleDateString('ar-EG'))}`
        : 'بشكل دائم';
      return {
        subject: 'تم إيقاف حسابك - PropMatch',
        html: layout(
          'تم إيقاف حسابك',
          job.name,
          `<p>أوقف أحد المشرفين حسابك ${duration}.</p>${reasonParagraph(job.reason)}${job.note ? `<p><strong>ملاحظة:</strong> ${escapeHtml(job.note)}</p>` : ''}`,
          baseUrl,
        ),
      };
    }
    case 'ACCOUNT_UNSUSPENDED':
      return {
        subject: 'تم رفع الإيقاف عن حسابك - PropMatch',
        html: layout(
          'تم رفع الإيقاف عن حسابك',
          job.name,
          `<p>يمكنك الآن استخدام حسابك بصورة طبيعية.</p>${actionButton('تسجيل الدخول', `${baseUrl}/login`)}`,
          baseUrl,
        ),
      };
    case 'ACCOUNT_DELETED':
      return {
        subject: 'تم حذف حسابك بواسطة الإدارة - PropMatch',
        html: layout(
          'تم حذف حسابك',
          job.name,
          `<p>حذفت الإدارة حسابك وأرشفت إعلاناتك وطلباتك. يمكنك تقديم طلب إعادة تفعيل خلال 30 يوماً قبل إخفاء بيانات الحساب نهائياً.</p>${actionButton('طلب إعادة التفعيل', `${baseUrl}/login`)}`,
          baseUrl,
        ),
      };
    case 'ACCOUNT_REACTIVATED':
      return {
        subject: 'تمت إعادة تفعيل حسابك - PropMatch',
        html: layout(
          'تمت إعادة تفعيل حسابك',
          job.name,
          `<p>وافق أحد المشرفين على طلب إعادة تفعيل حسابك. تبقى عقاراتك وطلباتك السابقة مؤرشفة حتى تنشرها من جديد.</p>${actionButton('تسجيل الدخول', `${baseUrl}/login`)}`,
          baseUrl,
        ),
      };
    case 'ACCOUNT_REACTIVATION_REJECTED':
      return {
        subject: 'طلب إعادة التفعيل - PropMatch',
        html: layout(
          'طلب إعادة التفعيل',
          job.name,
          '<p>راجع أحد المشرفين طلبك ولم تتم الموافقة عليه في الوقت الحالي. يمكنك تقديم طلب جديد لاحقاً.</p>',
          baseUrl,
        ),
      };
    case 'SUPPORT_REPLY':
      return {
        subject: 'رد جديد من الدعم الفني - PropMatch',
        html: layout(
          'رد جديد من الدعم الفني',
          job.name,
          `<p>أضاف فريق الدعم الفني رداً جديداً على تذكرتك:</p><p style="padding:12px;background:#f5f5f5;border-radius:6px">${escapeHtml(job.preview)}</p>${actionButton('عرض التذكرة', `${baseUrl}/support/tickets/${encodeURIComponent(job.ticketId)}`)}`,
          baseUrl,
        ),
      };
    case 'ADMIN_WELCOME':
      return {
        subject: 'تم إنشاء حسابك الإداري - PropMatch',
        html: layout(
          'مرحباً بك في فريق الإدارة',
          job.name,
          `<p>تم إنشاء حساب إداري لك بصلاحية «${escapeHtml(job.roleLabel)}». استخدم بيانات الدخول التي زودك بها المشرف العام.</p>${actionButton('دخول لوحة الإدارة', `${baseUrl}/login`)}`,
          baseUrl,
        ),
      };
    case 'ADMIN_ACCOUNT_UPDATED':
      return {
        subject: 'تم تحديث حسابك الإداري - PropMatch',
        html: layout(
          'تم تحديث حسابك الإداري',
          job.name,
          `<p>الدور الحالي: «${escapeHtml(job.roleLabel)}».</p><p>حالة الحساب: ${job.disabled ? 'معطل' : 'نشط'}.</p>${job.disabled ? '' : actionButton('دخول لوحة الإدارة', `${baseUrl}/login`)}`,
          baseUrl,
        ),
      };
  }
}
