import type { Payment } from './service.js';

/**
 * M110 «الفاتورة الفورية»: the moment a payment settles paid, the customer gets a branded Arabic
 * invoice — mailed as HTML and served at /pay/invoice/:id (printable). Styled after the owner's
 * sample invoices (navy header, seller/customer cards, items table, gold accents).
 */

export const SELLER = {
  name: 'شركة فيبس فينتشرز القابضة',
  brand: 'Vibes Ventures',
  cr: '2050161213',
  unified: '7030567908',
  address: 'طريق الأمير محمد بن عبدالعزيز - التحلية - الرياض',
  addressEn: 'Prince Mohammed bin Abdulaziz Road - Al Tahlia - Riyadh',
  email: 'Info@vibesholding.com',
  site: 'vibesholding.com',
  phones: ['+966558318777', '+966503844438'],
} as const;

const GATEWAY_LABEL: Record<string, string> = { moyasar: 'ميسر (Moyasar)', paymob: 'Paymob', code: 'كود خصم 100%', mock: 'بوابة تجريبية' };

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

const dateFormat = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric' });

function day(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(amount);
}

/** The invoice number the customer sees: a plain growing number, never the payment uuid. */
export function invoiceTitle(invoiceNo: number): string {
  return `فاتورة رقم ${invoiceNo}`;
}

/** Full printable HTML document; also the body of the customer mail. */
export function invoiceHtml(payment: Payment, invoiceNo: number): string {
  const gateway = GATEWAY_LABEL[payment.provider] ?? payment.provider;
  const discountRow =
    payment.discountCode && payment.preDiscountSar && payment.preDiscountSar > payment.amount
      ? `<tr><td class="item"><strong>خصم بكود ${escape(payment.discountCode)}${payment.discountPercent ? ` (${payment.discountPercent}%)` : ''}</strong></td>
         <td class="num">−${money(payment.preDiscountSar - payment.amount)}</td></tr>`
      : '';
  const baseAmount = payment.preDiscountSar && payment.preDiscountSar > payment.amount ? payment.preDiscountSar : payment.amount;
  const answers = payment.answers
    .filter((answer) => answer.key !== 'discount')
    .map((answer) => `${escape(answer.label)}: ${escape(answer.value)}`)
    .join(' · ');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${invoiceTitle(invoiceNo)} — ${escape(SELLER.brand)}</title>
<style>
  body{margin:0;background:#EEF1F6;font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif;color:#1C2B4A}
  .page{max-width:820px;margin:0 auto;background:#fff}
  .bar{background:#1F3A6E;color:#fff;padding:14px 28px;font-weight:700;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px}
  .bar .en{direction:ltr;font-size:13px}
  .head{padding:26px 28px 10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
  h1{margin:0;font-size:24px;color:#1F3A6E}
  .badge{background:#F6C445;color:#1C2B4A;border-radius:20px;padding:6px 16px;font-weight:700;font-size:14px}
  .meta{display:flex;flex-wrap:wrap;gap:10px;padding:6px 28px 0}
  .meta div{flex:1;min-width:140px;background:#F4F6FB;border-radius:10px;padding:10px 14px}
  .meta .k{font-size:12px;color:#5A6B8C}.meta .v{font-weight:700;margin-top:2px}
  .cards{display:flex;gap:10px;padding:14px 28px 0;flex-wrap:wrap}
  .card{flex:1;min-width:250px;border:1px solid #E1E6F0;border-radius:12px;padding:14px 16px}
  .card h3{margin:0 0 10px;color:#1F3A6E;font-size:15px;border-bottom:1px solid #E1E6F0;padding-bottom:8px}
  .row{display:flex;justify-content:space-between;gap:10px;margin:4px 0;font-size:13px}
  .row .k{color:#5A6B8C}.row .v{font-weight:600;text-align:left}
  table{width:calc(100% - 56px);margin:18px 28px 0;border-collapse:collapse}
  thead th{background:#1F3A6E;color:#fff;padding:10px 12px;font-size:13px;text-align:right}
  thead th.num,td.num{text-align:left;direction:ltr}
  td{padding:12px;border-bottom:1px solid #E9EDF5;font-size:14px;vertical-align:top}
  td .sub{color:#5A6B8C;font-size:12px;margin-top:4px}
  .total{background:#1F3A6E;color:#fff;margin:18px 28px 0;border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center}
  .total .amount{direction:ltr;font-size:20px;font-weight:800}
  .note{margin:14px 28px;background:#FFF8E6;border:1px solid #F6C445;border-radius:10px;padding:12px 16px;font-size:13px;color:#5A4A12}
  .foot{background:#1F3A6E;color:#fff;margin-top:22px;padding:16px 28px;font-size:13px;text-align:center;line-height:2}
  .foot bdi{direction:ltr}
  @media print{body{background:#fff}.page{max-width:none}}
</style></head><body><div class="page">
<div class="bar"><span>سجل تجاري: <bdi dir="ltr">${SELLER.cr}</bdi></span><span class="en">${escape(SELLER.brand)}</span></div>
<div class="head"><h1>فاتورة ${escape(payment.serviceTitle)}</h1><span class="badge">مدفوعة بالكامل ✓</span></div>
<div class="meta">
  <div><div class="k">رقم الفاتورة</div><div class="v"><bdi dir="ltr">${invoiceNo}</bdi></div></div>
  <div><div class="k">تاريخ الدفع</div><div class="v">${day(payment.paidAt)}</div></div>
  <div><div class="k">تاريخ الإصدار</div><div class="v">${day(payment.paidAt ?? payment.createdAt)}</div></div>
  <div><div class="k">بوابة الدفع</div><div class="v">${escape(gateway)}</div></div>
</div>
<div class="cards">
  <div class="card"><h3>بيانات البائع</h3>
    <div class="row"><span class="k">الاسم</span><span class="v">${SELLER.name}</span></div>
    <div class="row"><span class="k">السجل التجاري</span><span class="v"><bdi dir="ltr">${SELLER.cr}</bdi></span></div>
    <div class="row"><span class="k">الرقم الوطني الموحد</span><span class="v"><bdi dir="ltr">${SELLER.unified}</bdi></span></div>
    <div class="row"><span class="k">العنوان</span><span class="v">${SELLER.address}</span></div>
    <div class="row"><span class="k">البريد الإلكتروني</span><span class="v"><bdi dir="ltr">${SELLER.email}</bdi></span></div>
  </div>
  <div class="card"><h3>بيانات العميل</h3>
    <div class="row"><span class="k">الاسم</span><span class="v">${escape(payment.name || '—')}</span></div>
    ${payment.phone ? `<div class="row"><span class="k">رقم الجوال</span><span class="v"><bdi dir="ltr">${escape(payment.phone)}</bdi></span></div>` : ''}
    ${payment.email ? `<div class="row"><span class="k">البريد الإلكتروني</span><span class="v"><bdi dir="ltr">${escape(payment.email)}</bdi></span></div>` : ''}
  </div>
</div>
<table>
  <thead><tr><th>البند</th><th class="num">القيمة (ريال سعودي)</th></tr></thead>
  <tbody>
    <tr><td class="item"><strong>${escape(payment.serviceTitle)}</strong>${answers ? `<div class="sub">${answers}</div>` : ''}${payment.memberPrice ? '<div class="sub">سعر الأعضاء — خصم العضوية مطبق</div>' : ''}</td>
    <td class="num">${money(baseAmount)}</td></tr>
    ${discountRow}
  </tbody>
</table>
<div class="total"><span>إجمالي المبلغ المدفوع</span><span class="amount">SAR ${money(payment.amount)}</span></div>
<div class="note">صدرت هذه الفاتورة إلكترونيًا من ${APP_LINE} وتثبت سداد المبلغ المذكور أعلاه بالكامل عبر بوابة ${escape(gateway)}.${payment.transactionId ? ` مرجع العملية: <bdi dir="ltr">${escape(payment.transactionId)}</bdi>` : ''}</div>
<div class="foot">${SELLER.addressEn}<br><bdi>${SELLER.phones.join('</bdi> · <bdi>')}</bdi> · <bdi>${SELLER.site}</bdi> · <bdi>${SELLER.email}</bdi></div>
</div></body></html>`;
}

const APP_LINE = 'تطبيق نادي المستثمرين — Vibes Ventures';

/** The plain-text twin of the invoice mail (clients without HTML). */
export function invoiceText(payment: Payment, invoiceNo: number, url: string): string {
  return [
    `${invoiceTitle(invoiceNo)} — ${payment.serviceTitle}`,
    `المبلغ المدفوع: ${money(payment.amount)} ريال سعودي`,
    `تاريخ الدفع: ${day(payment.paidAt)}`,
    `البائع: ${SELLER.name} — سجل تجاري ${SELLER.cr}`,
    `فاتورتك الكاملة: ${url}`,
    'شكرًا لتعاملك مع نادي المستثمرين.',
  ].join('\n');
}
