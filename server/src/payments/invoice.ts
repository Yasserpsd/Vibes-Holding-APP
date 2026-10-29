import type { AppLang } from '../lang.js';
import type { Payment } from './service.js';

/**
 * M110 «الفاتورة الفورية»: the moment a payment settles paid, the customer gets a branded invoice —
 * mailed as HTML and served at /pay/invoice/:id (printable). Styled after the owner's samples
 * (navy header, seller/customer cards, items table, gold accents).
 * M113 (owner, 2026-10-21): EMAIL-SAFE layout — nested tables with inline styles only (mail clients
 * strip flex/grid) and explicit directions on every mixed value; and the invoice follows the
 * CUSTOMER'S app language («لو العميل فاتح من إنجليزي الفاتورة بالكامل إنجليزي») — the app sends
 * x-app-lang with the payment and the stored `lang` picks the whole rendering.
 */

export const SELLER = {
  name: 'شركة فيبس فينتشرز القابضة',
  nameEn: 'VIBES VENTURES COMPANY HOLDING',
  brand: 'Vibes Ventures',
  cr: '2050161213',
  unified: '7030567908',
  address: 'طريق الأمير محمد بن عبدالعزيز - التحلية - الرياض',
  addressEn: 'Prince Mohammed bin Abdulaziz Road - Al Tahlia - Riyadh',
  email: 'Info@vibesholding.com',
  site: 'vibesholding.com',
  phones: ['+966558318777', '+966503844438'],
} as const;

const GATEWAY_LABEL: Record<AppLang, Record<string, string>> = {
  ar: { moyasar: 'ميسر (Moyasar)', paymob: 'Paymob', code: 'كود خصم 100%', mock: 'بوابة تجريبية' },
  en: { moyasar: 'Moyasar', paymob: 'Paymob', code: '100% discount code', mock: 'Test gateway' },
};

/** Every fixed phrase on the invoice, per language. */
const L = {
  ar: {
    cr: 'سجل تجاري',
    invoice: 'فاتورة',
    paid: 'مدفوعة بالكامل ✓',
    invoiceNo: 'رقم الفاتورة',
    payDate: 'تاريخ الدفع',
    issueDate: 'تاريخ الإصدار',
    gateway: 'بوابة الدفع',
    seller: 'بيانات البائع',
    customer: 'بيانات العميل',
    name: 'الاسم',
    sellerCr: 'السجل التجاري',
    unified: 'الرقم الوطني الموحد',
    address: 'العنوان',
    email: 'البريد الإلكتروني',
    phone: 'رقم الجوال',
    item: 'البند',
    amount: 'القيمة (ريال سعودي)',
    memberPrice: 'سعر الأعضاء — خصم العضوية مطبق',
    discountBy: 'خصم بكود',
    total: 'إجمالي المبلغ المدفوع',
    reference: 'مرجع العملية:',
    appName: 'تطبيق نادي المستثمرين',
  },
  en: {
    cr: 'CR No.',
    invoice: 'Invoice',
    paid: 'PAID IN FULL ✓',
    invoiceNo: 'Invoice No.',
    payDate: 'Payment date',
    issueDate: 'Issue date',
    gateway: 'Payment gateway',
    seller: 'Seller',
    customer: 'Customer',
    name: 'Name',
    sellerCr: 'CR No.',
    unified: 'Unified National No.',
    address: 'Address',
    email: 'Email',
    phone: 'Phone',
    item: 'Item',
    amount: 'Amount (SAR)',
    memberPrice: 'Member price — membership discount applied',
    discountBy: 'Discount code',
    total: 'Total paid',
    reference: 'Transaction reference:',
    appName: 'The Investors Club app',
  },
} as const satisfies Record<AppLang, Record<string, string>>;

// M138 (owner, 2026-10-29: «فاتورة ملكية»): the invoice wears the royal shell's palette (mail/royal.ts) —
// navy #0d274a, gold #e7ad3f, ivory washes, the club logo in the header and a gold frame.
const NAVY = '#0d274a';
const INK = '#111111';
const MUTED = '#7A6320';
const LINE = '#EADFC2';
const WASH = '#FBF7EC';
const GOLD = '#e7ad3f';
const CLUB_LOGO_URL =
  'https://vcmem.com/wp-content/uploads/2025/11/%D9%84%D9%88%D8%AC%D9%88-%D9%86%D8%A7%D8%AF%D9%8A-%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D8%AB%D9%85%D8%B1%D9%8A%D9%86-%D8%AC%D9%88%D9%88%D9%84%D8%AF-%D8%B4%D9%81%D8%A7%D9%81.png';
const FONT = `font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif`;

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

const dateFormats: Record<AppLang, Intl.DateTimeFormat> = {
  ar: new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric' }),
  en: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric' }),
};

/** «20 أكتوبر 2026» locked right-to-left so mail clients cannot reorder the pieces; plain in English. */
function day(value: string | null, lang: AppLang): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const text = dateFormats[lang].format(date);
  return lang === 'ar' ? `<span dir="rtl">&rlm;${text}&rlm;</span>` : escape(text);
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(amount);
}

/** The invoice number the customer sees: a plain growing number, never the payment uuid. */
export function invoiceTitle(invoiceNo: number, lang: AppLang = 'ar'): string {
  return lang === 'en' ? `Invoice No. ${invoiceNo}` : `فاتورة رقم ${invoiceNo}`;
}

/** The customer mail subject, in the customer's language. */
export function invoiceSubject(invoiceNo: number, lang: AppLang = 'ar'): string {
  return lang === 'en'
    ? `Your invoice from The Investors Club — ${invoiceTitle(invoiceNo, 'en')}`
    : `فاتورتك من نادي المستثمرين — ${invoiceTitle(invoiceNo, 'ar')}`;
}

/** One labeled meta cell («رقم الفاتورة» …) — a quarter of the meta row. */
function metaCell(label: string, value: string): string {
  return `<td width="25%" style="padding:4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${WASH};border-radius:10px"><tr><td style="${FONT};padding:10px 12px;text-align:center"><div style="font-size:12px;color:${MUTED};line-height:1.6">${label}</div><div style="font-size:15px;font-weight:700;color:${INK};line-height:1.8;white-space:nowrap">${value}</div></td></tr></table></td>`;
}

const ltr = (value: string): string => `<span dir="ltr">${escape(value)}</span>`;

/** Full printable HTML document; also the body of the customer mail.
 * `publicUrl` lets the company stamp render (served at /pay/invoice-stamp.png). */
export function invoiceHtml(payment: Payment, invoiceNo: number, lang: AppLang = 'ar', publicUrl?: string): string {
  const t = L[lang];
  const dir = lang === 'en' ? 'ltr' : 'rtl';
  const start = lang === 'en' ? 'left' : 'right';
  const end = lang === 'en' ? 'right' : 'left';
  const gateway = GATEWAY_LABEL[lang][payment.provider] ?? payment.provider;
  const sellerName = lang === 'en' ? SELLER.nameEn : SELLER.name;
  const sellerAddress = lang === 'en' ? SELLER.addressEn : SELLER.address;
  const baseAmount = payment.preDiscountSar && payment.preDiscountSar > payment.amount ? payment.preDiscountSar : payment.amount;
  const answers = payment.answers
    .filter((answer) => answer.key !== 'discount')
    .map((answer) => `${escape(answer.label)}: ${escape(answer.value)}`)
    .join(' · ');
  const cardRow = (label: string, value: string): string =>
    `<tr><td style="${FONT};font-size:12px;color:${MUTED};padding:5px 0;white-space:nowrap;vertical-align:top">${label}</td><td style="${FONT};font-size:13px;font-weight:600;color:${INK};padding:5px 10px;text-align:${end}">${value}</td></tr>`;
  const itemCell = `padding:12px 14px;border-bottom:1px solid ${LINE};${FONT};font-size:14px;color:${INK};vertical-align:top`;
  const numCell = `padding:12px 14px;border-bottom:1px solid ${LINE};${FONT};font-size:14px;color:${INK};text-align:${end};white-space:nowrap`;
  const discountRow =
    payment.discountCode && payment.preDiscountSar && payment.preDiscountSar > payment.amount
      ? `<tr><td style="${itemCell}"><strong>${t.discountBy} <span dir="ltr">${escape(payment.discountCode)}</span>${payment.discountPercent ? ` (${payment.discountPercent}%)` : ''}</strong></td><td dir="ltr" style="${numCell}">&minus;${money(payment.preDiscountSar - payment.amount)}</td></tr>`
      : '';
  const note =
    lang === 'en'
      ? `This invoice was issued electronically by ${t.appName} — <span dir="ltr">Vibes Ventures</span> and confirms full payment of the amount above through <bdi>${escape(gateway)}</bdi>.`
      : `صدرت هذه الفاتورة إلكترونيًا من ${t.appName} — <span dir="ltr">Vibes Ventures</span> وتثبت سداد المبلغ المذكور أعلاه بالكامل عبر بوابة <bdi>${escape(gateway)}</bdi>.`;
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${invoiceTitle(invoiceNo, lang)} — ${escape(SELLER.brand)}</title>
<style>:root{color-scheme:light}@media print{body{background:#fff !important}}</style></head>
<body style="margin:0;padding:0;background:#F3EFE6;${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EFE6"><tr><td align="center" style="padding:22px 8px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border:1px solid ${GOLD};border-radius:22px;overflow:hidden;box-shadow:0 14px 40px rgba(13,39,74,.14)">

<tr><td style="background:${NAVY};padding:26px 24px 18px;text-align:center;border-bottom:3px solid ${GOLD}">
  <img src="${CLUB_LOGO_URL}" alt="Investors Club" width="96" style="width:96px;height:auto;display:inline-block;border:0">
  <div style="${FONT};color:#F3E4B5;font-size:12px;letter-spacing:3px;margin-top:12px">INVESTORS CLUB · VIBES VENTURES</div>
  <div style="${FONT};color:#FFFFFF;font-size:22px;font-weight:700;margin-top:8px;line-height:1.5">${invoiceTitle(invoiceNo, lang)}</div>
  <div style="${FONT};color:${GOLD};font-size:15px;font-weight:600;margin-top:4px">${t.paid}</div>
</td></tr>

<tr><td style="background:${NAVY};padding:10px 24px;border-bottom:1px solid rgba(231,173,63,.35)">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="${FONT};color:#FFFFFF;font-size:14px;font-weight:700;white-space:nowrap">${t.cr}: ${ltr(SELLER.cr)}</td>
    <td dir="ltr" style="${FONT};color:#FFFFFF;font-size:13px;text-align:${end};white-space:nowrap">${escape(SELLER.brand)}</td>
  </tr></table>
</td></tr>

<tr><td style="padding:22px 24px 6px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="${FONT};font-size:21px;font-weight:700;color:${NAVY};line-height:1.6"><bdi>${t.invoice} — ${escape(payment.serviceTitle)}</bdi></td>
    <td align="${end}" style="vertical-align:top;padding-${start}:10px;white-space:nowrap"><span style="${FONT};display:inline-block;background:${GOLD};color:${NAVY};border-radius:20px;padding:6px 16px;font-weight:700;font-size:13px;white-space:nowrap">${t.paid}</span></td>
  </tr></table>
</td></tr>

<tr><td style="padding:8px 20px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${metaCell(t.invoiceNo, ltr(String(invoiceNo)))}
    ${metaCell(t.payDate, day(payment.paidAt, lang))}
    ${metaCell(t.issueDate, day(payment.paidAt ?? payment.createdAt, lang))}
    ${metaCell(t.gateway, `<bdi>${escape(gateway)}</bdi>`)}
  </tr></table>
</td></tr>

<tr><td style="padding:12px 20px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="50%" style="padding:4px;vertical-align:top">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px"><tr><td style="padding:14px 16px">
        <div style="${FONT};font-size:15px;font-weight:700;color:${NAVY};border-bottom:1px solid ${LINE};padding-bottom:8px;margin-bottom:6px">${t.seller}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${cardRow(t.name, `<bdi>${escape(sellerName)}</bdi>`)}
          ${cardRow(t.sellerCr, ltr(SELLER.cr))}
          ${cardRow(t.unified, ltr(SELLER.unified))}
          ${cardRow(t.address, `<bdi>${escape(sellerAddress)}</bdi>`)}
          ${cardRow(t.email, ltr(SELLER.email))}
        </table>
      </td></tr></table>
    </td>
    <td width="50%" style="padding:4px;vertical-align:top">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px"><tr><td style="padding:14px 16px">
        <div style="${FONT};font-size:15px;font-weight:700;color:${NAVY};border-bottom:1px solid ${LINE};padding-bottom:8px;margin-bottom:6px">${t.customer}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${cardRow(t.name, `<bdi>${escape(payment.name || '—')}</bdi>`)}
          ${payment.phone ? cardRow(t.phone, ltr(payment.phone)) : ''}
          ${payment.email ? cardRow(t.email, ltr(payment.email)) : ''}
        </table>
      </td></tr></table>
    </td>
  </tr></table>
</td></tr>

<tr><td style="padding:16px 24px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>
      <th style="background:${NAVY};color:#FFFFFF;${FONT};font-size:13px;padding:10px 14px;text-align:${start}">${t.item}</th>
      <th style="background:${NAVY};color:#FFFFFF;${FONT};font-size:13px;padding:10px 14px;text-align:${end};white-space:nowrap">${t.amount}</th>
    </tr>
    <tr>
      <td style="${itemCell}"><strong><bdi>${escape(payment.serviceTitle)}</bdi></strong>${answers ? `<div style="color:${MUTED};font-size:12px;margin-top:4px;line-height:1.8"><bdi>${answers}</bdi></div>` : ''}${payment.memberPrice ? `<div style="color:${MUTED};font-size:12px;margin-top:2px">${t.memberPrice}</div>` : ''}</td>
      <td dir="ltr" style="${numCell}">${money(baseAmount)}</td>
    </tr>
    ${discountRow}
  </table>
</td></tr>

<tr><td style="padding:16px 24px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY};border-radius:10px"><tr>
    <td style="${FONT};color:#FFFFFF;font-size:15px;font-weight:700;padding:14px 18px">${t.total}</td>
    <td dir="ltr" style="${FONT};color:#FFFFFF;font-size:19px;font-weight:800;padding:14px 18px;text-align:${end};white-space:nowrap">SAR ${money(payment.amount)}</td>
  </tr></table>
</td></tr>

<tr><td style="padding:14px 24px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8E6;border:1px solid ${GOLD};border-radius:10px"><tr>
    <td style="${FONT};font-size:12.5px;color:#5A4A12;padding:12px 16px;line-height:1.9">${note}${payment.transactionId ? ` ${t.reference} ${ltr(payment.transactionId)}` : ''}</td>
  </tr></table>
</td></tr>

${publicUrl ? `<tr><td align="center" style="padding:18px 24px 6px"><img src="${publicUrl}/pay/invoice-stamp.png" width="128" height="128" alt="${escape(SELLER.brand)}" style="display:block;width:128px;height:128px;opacity:0.92"></td></tr>` : ''}

<tr><td style="background:${NAVY};padding:14px 24px;margin-top:20px;border-top:3px solid ${GOLD}">
  <div dir="ltr" style="${FONT};color:#FFFFFF;font-size:12.5px;text-align:center;line-height:2">
    <span style="color:#FFFFFF">${escape(SELLER.addressEn)}</span><br>
    ${SELLER.phones.map((phone) => `<a href="tel:${escape(phone)}" style="color:#FFFFFF;text-decoration:none">${escape(phone)}</a>`).join(' · ')}
    · <a href="https://${escape(SELLER.site)}" style="color:#FFFFFF;text-decoration:none">${escape(SELLER.site)}</a>
    · <a href="mailto:${escape(SELLER.email)}" style="color:#FFFFFF;text-decoration:none">${escape(SELLER.email)}</a>
  </div>
</td></tr>

</table>
<div style="${FONT};font-size:11px;color:${MUTED};padding:10px 0">${t.appName} — ${invoiceTitle(invoiceNo, lang)}</div>
</td></tr></table>
</body></html>`;
}

/** The plain-text twin of the invoice mail (clients without HTML). */
export function invoiceText(payment: Payment, invoiceNo: number, url: string, lang: AppLang = 'ar'): string {
  if (lang === 'en') {
    return [
      `${invoiceTitle(invoiceNo, 'en')} — ${payment.serviceTitle}`,
      `Total paid: SAR ${money(payment.amount)}`,
      `Seller: ${SELLER.nameEn} — CR ${SELLER.cr}`,
      `Your full invoice: ${url}`,
      'Thank you for choosing The Investors Club.',
    ].join('\n');
  }
  return [
    `${invoiceTitle(invoiceNo, 'ar')} — ${payment.serviceTitle}`,
    `المبلغ المدفوع: ${money(payment.amount)} ريال سعودي`,
    `البائع: ${SELLER.name} — سجل تجاري ${SELLER.cr}`,
    `فاتورتك الكاملة: ${url}`,
    'شكرًا لتعاملك مع نادي المستثمرين.',
  ].join('\n');
}
