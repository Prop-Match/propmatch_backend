/**
 * Server-side mirror of the frontend's Hybrid Contract Builder — same 15
 * mandatory clauses (src/features/contracts/builder/mandatoryClauses.ts on
 * the frontend, sourced from the standard Egyptian apartment lease),
 * rendered to PDF via a headless browser. National IDs appear here, in the
 * PDF only; the API response masks them to the last 4 digits.
 */

const MANDATORY_CLAUSES: { title: string; body: string }[] = [
  {
    title: 'البند الأول: وصف العين المؤجرة',
    body: 'بموجب هذا العقد أجّر الطرف الأول للطرف الثاني العقار الكائن في: {{propertyAddress}}.',
  },
  {
    title: 'البند الثاني: مدة التعاقد',
    body: 'مدة هذا العقد تبدأ من {{startDate}} وتنتهي في {{endDate}}، وينتهي هذا العقد بنهاية مدته دون حاجة إلى تنبيه أو إنذار أو إجراءات أخرى، ولا يُجدد هذا العقد ولا يمتد لأي مدة جديدة إلا بعقد اتفاق جديد.',
  },
  {
    title: 'البند الثالث: القيمة الإيجارية',
    body: 'قيمة الإيجار المتفق عليها هي مبلغ وقدره {{rentAmount}} شهريًا. يدفع المستأجر الإيجار مقدمًا في بداية كل شهر إلى المؤجر ويحصل على إيصال بذلك، ولا يُعتبر المستأجر قد سدد دين الإيجار إلا إذا كان لديه هذا الإيصال.',
  },
  {
    title: 'البند الرابع: التأمين النقدي',
    body: 'يحق للطرف الأول تقاضي مبلغ تأمين، يُرد هذا المبلغ للطرف الثاني (المستأجر) في نهاية مدة العقد إن كان له وجه حق فيه.',
  },
  {
    title: 'البند الخامس: تأخر المستأجر عن سداد الإيجار',
    body: 'إذا تأخر المستأجر عن دفع الإيجار في المواعيد المحددة لمدة تُذكر في المدة المتفق عليها، يُعتبر عقد الإيجار هذا مفسوخًا من تلقاء نفسه دون الحاجة إلى تنبيه أو إنذار أو إعذار، وبدون الحصول على حكم استحقاق قضائي. كما يحق للطرف الأول طرد المستأجر وإلزامه بدفع المتأخرات والتعويضات إذا كان لها مبرر قانوني.',
  },
  {
    title: 'البند السادس: عدم جواز التأجير من الباطن',
    body: 'ليس من حق الطرف الثاني (المستأجر) تأجير العين محل العقد من الباطن أو التنازل عنها للغير، وليس من حقه كذلك إحداث أي تغيير بالعين دون إذن كتابي من الطرف الأول (المؤجر). وإذا خالف المستأجر هذا الشرط، يعتبر العقد مفسوخًا تلقائيًا دون الحاجة إلى تنبيه أو إنذار أو الحصول على حكم قضائي.',
  },
  {
    title: 'البند السابع: عدم جواز تغيير الغرض من التأجير',
    body: 'ليس من حق الطرف الثاني (المستأجر) استغلال العين محل العقد لغير الغرض المؤجرة من أجله، والغرض هو السكن والمعيشة. وفي حالة حدوث ذلك يعتبر هذا العقد مفسوخًا من تلقاء نفسه دون الحاجة إلى حكم قضائي أو تنبيه أو إنذار.',
  },
  {
    title: 'البند الثامن: ما ينفقه المستأجر على العين المؤجرة',
    body: 'جميع النفقات التي يتحملها المستأجر على العين المؤجرة بعد استلامها، مثل الدهانات أو لصق الورق أو الديكور وغيره، لا تلزم المؤجر بشيء منها، ولا يحق للمستأجر المطالبة بقيمة ما أنفقه قضاءً أو رضاءً.',
  },
  {
    title: 'البند التاسع: العناية بالعين المؤجرة',
    body: 'يلتزم المستأجر بإجراء الترميمات الضرورية للعين المؤجرة الناتجة عن الاستعمال طوال مدة الإيجار.',
  },
  {
    title: 'البند العاشر: رد العين المؤجرة بحالتها عند الإيجار',
    body: 'يلتزم المستأجر برد العين المؤجرة للطرف الأول عند انتهاء مدة التعاقد بالحالة التي عليها وقت التعاقد دون أي إتلاف، ويتحمل المستأجر كافة النفقات إذا حدث للعين تلفيات ترجع إلى خطأ المستأجر.',
  },
  {
    title: 'البند الحادي عشر: التسليم بعد انتهاء العقد والتعويض عند المماطلة',
    body: 'لا يحق للطرف الثاني المماطلة أو المنازعة في تسليم العين المؤجرة للطرف الأول عند انتهاء مدة العقد لأي سبب كان، ويعتبر وضع يد الطرف الثاني على العين دون عقد جديد بعد انتهاء المدة وضع يد غاصب. يحق للطرف الأول طرد الطرف الثاني بكافة الوسائل، ويلتزم المستأجر بدفع تعويض عن الخسائر التي لحقت بالمؤجر.',
  },
  {
    title: 'البند الثاني عشر: سداد مستحقات المرافق',
    body: 'يلتزم المستأجر بدفع قيمة فواتير المياه والكهرباء والغاز طوال المدة الإيجارية، ويحق للطرف الأول توقيع الحجز على المنقولات الموجودة بالعين المؤجرة لاستيفاء المبالغ المطلوبة عند عدم السداد.',
  },
  {
    title: 'البند الثالث عشر: رغبة المستأجر في إنهاء العقد قبل نهاية مدته',
    body: 'إذا رغب الطرف الثاني في إنهاء هذا العقد قبل نهاية مدته، فعليه إخطار الطرف الأول بذلك قبل شهر على الأقل بإنذار رسمي. في حال عدم الامتثال لهذا الشرط، يكون المستأجر ملزمًا بدفع أجرة شهر كامل بعد ترك العين المؤجرة.',
  },
  {
    title: 'البند الرابع عشر: العناوين والمراسلات',
    body: 'يقر أطراف هذا التعاقد بأن محل الإقامة الوارد قرين كل طرف صحيح، وأن أي إخطار قانوني أو قضائي أو خطاب موصى عليه بعلم الوصول يتم توجيهه إلى تلك العناوين صحيح.',
  },
  {
    title: 'البند الخامس عشر: عدد نسخ العقد والاختصاص القضائي',
    body: 'حُرر هذا العقد من نسختين، بيد كل طرف نسخة للعمل بموجبها عند اللزوم والاقتضاء.',
  },
];

export interface LeaseContractHtmlInput {
  ownerName: string;
  ownerNationalId: string;
  tenantName: string;
  tenantNationalId: string;
  propertyAddress: string;
  rentAmount: number;
  startDate: Date;
  endDate: Date;
  customClauses?: string[] | null;
  witness1Name?: string | null;
  witness1NationalId?: string | null;
  witness2Name?: string | null;
  witness2NationalId?: string | null;
  generatedAt: Date;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Wraps a value that must render left-to-right (dates, national IDs, ...)
 * inside Arabic text, so bidi reordering can't flip its digit order. */
const ltr = (s: string) => `<span dir="ltr" class="nid">${s}</span>`;

export function buildLeaseContractHtml(input: LeaseContractHtmlInput): string {
  const fmtDate = (d: Date) =>
    ltr(
      new Intl.DateTimeFormat('ar-EG', {
        numberingSystem: 'latn',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(d),
    );
  const fmtEGP = (n: number) =>
    `${ltr(new Intl.NumberFormat('ar-EG', { numberingSystem: 'latn' }).format(n))} ج.م`;
  const fillPlaceholders = (body: string) =>
    body
      .replaceAll('{{propertyAddress}}', esc(input.propertyAddress))
      .replaceAll('{{rentAmount}}', fmtEGP(input.rentAmount))
      .replaceAll('{{startDate}}', fmtDate(input.startDate))
      .replaceAll('{{endDate}}', fmtDate(input.endDate));

  const mandatoryHtml = MANDATORY_CLAUSES.map(
    (c) =>
      `<div class="clause"><b>${esc(c.title)}</b><p>${fillPlaceholders(c.body)}</p></div>`,
  ).join('\n');

  const customClauses = input.customClauses ?? [];
  const customHtml = customClauses.length
    ? `<div class="clause"><b>بنود إضافية متفق عليها</b></div>\n` +
      customClauses
        .map(
          (text, i) =>
            `<div class="clause"><b>بند إضافي ${i + 1}:</b> ${esc(text)}</div>`,
        )
        .join('\n')
    : '';

  const witnessRow = (name?: string | null, nationalId?: string | null) =>
    name
      ? `<div><p>${esc(name)}</p>${nationalId ? `<p class="witness-nid">الرقم القومي: ${ltr(esc(nationalId))}</p>` : ''}</div>`
      : '<div><p>&nbsp;</p></div>';
  const hasWitnesses = Boolean(input.witness1Name || input.witness2Name);
  const witnessesHtml = hasWitnesses
    ? `<section class="witnesses">
        <p class="section-title">الشهود</p>
        <div class="witness-row">
          <div><p class="witness-label">الشاهد الأول</p>${witnessRow(input.witness1Name, input.witness1NationalId)}</div>
          <div><p class="witness-label">الشاهد الثاني</p>${witnessRow(input.witness2Name, input.witness2NationalId)}</div>
        </div>
      </section>`
    : '';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; line-height: 1.9; padding: 48px; color: #1a1a1a; }
  header { text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { margin: 0; font-size: 24px; }
  .sub { color: #666; font-size: 13px; margin-top: 4px; }
  .party { margin: 8px 0; page-break-inside: avoid; }
  .clause { margin: 12px 0; page-break-inside: avoid; }
  .clause b { color: #111; }
  .clause p { margin: 4px 0 0; }
  .section-title { font-weight: bold; margin: 24px 0 8px; }
  .witnesses { margin-top: 32px; page-break-inside: avoid; }
  .witness-row { display: flex; justify-content: space-between; gap: 24px; }
  .witness-row > div { width: 45%; text-align: center; }
  .witness-label { font-weight: bold; margin-bottom: 8px; }
  .witness-nid { font-size: 13px; color: #555; }
  footer { display: flex; justify-content: space-between; margin-top: 48px; padding-top: 24px; text-align: center; page-break-inside: avoid; }
  footer div { width: 45%; }
  footer p:first-child { margin-bottom: 48px; font-weight: bold; }
  footer p:last-child { border-top: 1px solid #ccc; padding-top: 8px; }
  .nid { unicode-bidi: embed; }
</style>
</head>
<body>
  <header>
    <h1>عقد إيجار</h1>
    <p class="sub">جمهورية مصر العربية — عقد إيجار سكني</p>
  </header>

  <p>إنه في يوم ${fmtDate(input.generatedAt)}، تم الاتفاق بين كل من:</p>

  <div class="party"><b>الطرف الأول (المالك):</b> ${esc(input.ownerName)} — الرقم القومي: ${ltr(esc(input.ownerNationalId))}</div>
  <div class="party"><b>الطرف الثاني (المستأجر):</b> ${esc(input.tenantName)} — الرقم القومي: ${ltr(esc(input.tenantNationalId))}</div>

  ${mandatoryHtml}
  ${customHtml}

  <footer>
    <div><p>الطرف الأول (المالك)</p><p>${esc(input.ownerName)}</p></div>
    <div><p>الطرف الثاني (المستأجر)</p><p>${esc(input.tenantName)}</p></div>
  </footer>

  ${witnessesHtml}
</body>
</html>`;
}

/** Rendered per-page by Puppeteer's own footer mechanism (page.pdf's
 * displayHeaderFooter/footerTemplate) — a plain in-content CSS footer only
 * shows once, on the last page, so page.pdf handles the repetition. */
export function buildLeaseContractPdfFooterHtml(): string {
  return `<div style="width:100%; font-size:9px; text-align:center; color:#999; padding:4px 0; font-family: Tahoma, Arial, sans-serif;" dir="rtl">
    تم إنشاء هذا العقد بواسطة منصة PropMatch AI
  </div>`;
}
