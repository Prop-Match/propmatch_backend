export interface RentalContractDraftPdfInput {
  contractId: string;
  ownerName: string;
  tenantName: string;
  propertyAddress: string;
  rentAmount: number;
  startDate: Date;
  endDate: Date;
  customClauses: string[];
  generatedAt: Date;
}

const DISCLAIMER =
  'هذه مسودة عقد إيجار للمراجعة فقط، وليست توقيعًا إلكترونيًا أو توثيقًا قانونيًا أو تسجيلًا حكوميًا. يجب مراجعتها قبل التوقيع أو الاعتماد عليها.';
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const date = (value: Date) =>
  new Intl.DateTimeFormat('ar-EG', {
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(value);
const money = (value: number) =>
  new Intl.NumberFormat('ar-EG', { numberingSystem: 'latn' }).format(value);

/** Deterministic, offline-only Arabic RTL template for a saved DRAFTING row. */
export function buildRentalContractDraftPdfHtml(
  input: RentalContractDraftPdfInput,
): string {
  const clauses = input.customClauses.length
    ? input.customClauses
        .map(
          (clause, index) =>
            `<li><b>بند إضافي ${index + 1}:</b> ${escapeHtml(clause)}</li>`,
        )
        .join('')
    : '<li>لا توجد بنود إضافية محفوظة.</li>';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 18mm 16mm 20mm; }
    html, body { background:#fff; } body { font-family: Arial, Tahoma, sans-serif; direction:rtl; color:#171717; line-height:1.8; font-size:14px; }
    h1 { text-align:center; margin:0 0 6px; font-size:27px; } .draft { text-align:center; color:#9b1c1c; font-weight:bold; border:1px solid #dc2626; padding:7px; margin:0 0 20px; }
    .meta, .details { border-collapse:collapse; width:100%; margin:14px 0; } .meta td, .details td { border:1px solid #ddd; padding:8px; vertical-align:top; } .meta td:first-child, .details td:first-child { width:32%; font-weight:bold; background:#f8fafc; }
    .notice { border:2px solid #b91c1c; background:#fef2f2; padding:12px; font-weight:bold; margin:18px 0; page-break-inside:avoid; } h2 { font-size:18px; margin-top:24px; } ul { padding-right:22px; } li { margin:8px 0; page-break-inside:avoid; } .ltr { direction:ltr; unicode-bidi:embed; display:inline-block; }
  </style></head><body>
  <h1>مسودة عقد إيجار</h1><div class="draft">مسودة غير موقعة وغير موثقة</div>
  <div class="notice">${DISCLAIMER}</div>
  <table class="meta"><tr><td>رقم العقد</td><td><span class="ltr">${escapeHtml(input.contractId)}</span></td></tr><tr><td>تاريخ إنشاء ملف PDF</td><td>${date(input.generatedAt)}</td></tr></table>
  <table class="details"><tr><td>اسم المؤجر</td><td>${escapeHtml(input.ownerName)}</td></tr><tr><td>اسم المستأجر</td><td>${escapeHtml(input.tenantName)}</td></tr><tr><td>عنوان العقار</td><td>${escapeHtml(input.propertyAddress)}</td></tr><tr><td>قيمة الإيجار</td><td><span class="ltr">${money(input.rentAmount)}</span> ج.م شهريًا</td></tr><tr><td>تاريخ البداية</td><td>${date(input.startDate)}</td></tr><tr><td>تاريخ النهاية</td><td>${date(input.endDate)}</td></tr></table>
  <h2>البنود الإضافية المدخلة من المستخدم</h2><ul>${clauses}</ul>
  <div class="notice">${DISCLAIMER}</div>
  </body></html>`;
}
