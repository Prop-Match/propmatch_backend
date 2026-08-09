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
  return `<div style="text-align:center;margin:30px 0"><a href="${escapeHtml(url)}" style="background:#0d9488;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block">${escapeHtml(label)}</a></div>`;
}

function layout(title: string, name: string, body: string): string {
  return `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e0e0e0;border-radius:8px"><h2 style="color:#0d9488;text-align:center">${escapeHtml(title)} - PropMatch</h2><p>مرحباً ${escapeHtml(name)}،</p>${body}<hr style="border:none;border-top:1px solid #eee;margin:20px 0"><p style="font-size:12px;color:#999;text-align:center">هذه رسالة آلية من منصة PropMatch.</p></div>`;
}

function reasonParagraph(reason?: string): string {
  return reason ? `<p><strong>السبب:</strong> ${escapeHtml(reason)}</p>` : '';
}

export function renderMail(
  job: MailJobData,
  frontendUrl: string,
): RenderedMail {
  const baseUrl = frontendUrl.replace(/\/$/, '');
  switch (job.kind) {
    case 'PASSWORD_RESET': {
      const url = `${baseUrl}/reset-password?token=${encodeURIComponent(job.token)}`;
      return {
        subject: 'إعادة تعيين كلمة المرور - PropMatch',
        html: layout(
          'إعادة تعيين كلمة المرور',
          'مستخدم PropMatch',
          `<p>تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك.</p>${actionButton('إعادة تعيين كلمة المرور', url)}<p style="font-size:12px;color:#777">إذا لم تطلب ذلك، يمكنك تجاهل الرسالة.</p>`,
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
            ),
          }
        : {
            subject: 'مطلوب إعادة تقديم مستندات التوثيق - PropMatch',
            html: layout(
              'مطلوب تصحيح مستندات التوثيق',
              job.name,
              `<p>راجع فريقنا طلب توثيق هويتك، ونحتاج منك تصحيح المستندات وإعادة تقديمها.</p>${reasonParagraph(job.reason)}${actionButton('إعادة تقديم المستندات', `${baseUrl}/verify`)}`,
            ),
          };
    case 'PROPERTY_REVIEW':
      return {
        subject: `${job.approved ? 'تم قبول' : 'تم رفض'} إعلان العقار - PropMatch`,
        html: layout(
          job.approved ? 'تم قبول إعلان العقار' : 'تم رفض إعلان العقار',
          job.name,
          `<p>${job.approved ? 'تمت الموافقة على نشر' : 'لم نتمكن من الموافقة على'} عقارك «${escapeHtml(job.propertyTitle)}».</p>${reasonParagraph(job.reason)}${actionButton('عرض العقار', `${baseUrl}/landlord/properties/${encodeURIComponent(job.propertyId)}`)}`,
        ),
      };
    case 'TENANT_REQUEST_REVIEW':
      return {
        subject: `${job.approved ? 'تم قبول' : 'تم رفض'} طلب السكن - PropMatch`,
        html: layout(
          job.approved ? 'تم قبول طلب السكن' : 'تم رفض طلب السكن',
          job.name,
          `<p>${job.approved ? 'تمت الموافقة على طلب السكن الخاص بك وأصبح جاهزاً للمطابقة.' : 'لم نتمكن من الموافقة على طلب السكن الخاص بك.'}</p>${reasonParagraph(job.reason)}${actionButton('عرض طلباتي', `${baseUrl}/tenant/requests`)}`,
        ),
      };
    case 'USER_REVIEW_DECISION':
      return {
        subject: `${job.approved ? 'تم نشر' : 'تم رفض'} تقييمك - PropMatch`,
        html: layout(
          job.approved ? 'تم نشر تقييمك' : 'تم رفض تقييمك',
          job.name,
          `<p>${job.approved ? 'تمت الموافقة على تقييمك ونشره.' : 'لم نتمكن من نشر تقييمك.'}</p>${reasonParagraph(job.reason)}${actionButton('العودة إلى PropMatch', baseUrl)}`,
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
        ),
      };
    case 'ACCOUNT_DELETED':
      return {
        subject: 'تم حذف حسابك بواسطة الإدارة - PropMatch',
        html: layout(
          'تم حذف حسابك',
          job.name,
          `<p>حذفت الإدارة حسابك وأرشفت إعلاناتك وطلباتك. يمكنك تقديم طلب إعادة تفعيل خلال 30 يوماً قبل إخفاء بيانات الحساب نهائياً.</p>${actionButton('طلب إعادة التفعيل', `${baseUrl}/login`)}`,
        ),
      };
    case 'ACCOUNT_REACTIVATED':
      return {
        subject: 'تمت إعادة تفعيل حسابك - PropMatch',
        html: layout(
          'تمت إعادة تفعيل حسابك',
          job.name,
          `<p>وافق أحد المشرفين على طلب إعادة تفعيل حسابك. تبقى عقاراتك وطلباتك السابقة مؤرشفة حتى تنشرها من جديد.</p>${actionButton('تسجيل الدخول', `${baseUrl}/login`)}`,
        ),
      };
    case 'ACCOUNT_REACTIVATION_REJECTED':
      return {
        subject: 'طلب إعادة التفعيل - PropMatch',
        html: layout(
          'طلب إعادة التفعيل',
          job.name,
          '<p>راجع أحد المشرفين طلبك ولم تتم الموافقة عليه في الوقت الحالي. يمكنك تقديم طلب جديد لاحقاً.</p>',
        ),
      };
    case 'SUPPORT_REPLY':
      return {
        subject: 'رد جديد من الدعم الفني - PropMatch',
        html: layout(
          'رد جديد من الدعم الفني',
          job.name,
          `<p>أضاف فريق الدعم الفني رداً جديداً على تذكرتك:</p><p style="padding:12px;background:#f5f5f5;border-radius:6px">${escapeHtml(job.preview)}</p>${actionButton('عرض التذكرة', `${baseUrl}/support/tickets/${encodeURIComponent(job.ticketId)}`)}`,
        ),
      };
    case 'ADMIN_WELCOME':
      return {
        subject: 'تم إنشاء حسابك الإداري - PropMatch',
        html: layout(
          'مرحباً بك في فريق الإدارة',
          job.name,
          `<p>تم إنشاء حساب إداري لك بصلاحية «${escapeHtml(job.roleLabel)}». استخدم بيانات الدخول التي زودك بها المشرف العام.</p>${actionButton('دخول لوحة الإدارة', `${baseUrl}/login`)}`,
        ),
      };
    case 'ADMIN_ACCOUNT_UPDATED':
      return {
        subject: 'تم تحديث حسابك الإداري - PropMatch',
        html: layout(
          'تم تحديث حسابك الإداري',
          job.name,
          `<p>الدور الحالي: «${escapeHtml(job.roleLabel)}».</p><p>حالة الحساب: ${job.disabled ? 'معطل' : 'نشط'}.</p>${job.disabled ? '' : actionButton('دخول لوحة الإدارة', `${baseUrl}/login`)}`,
        ),
      };
  }
}
