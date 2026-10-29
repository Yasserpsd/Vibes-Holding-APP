import type { AppLang } from '../lang.js';
import { kindLabel, statusLabel, type MemberRequest } from '../requests/model.js';
import type { Payment } from './service.js';

/**
 * M110 «الفاتورة الفورية»: the moment a payment settles paid, the customer gets a branded invoice —
 * mailed as HTML and served at /pay/invoice/:id (printable). Styled after the owner's samples
 * (navy header, seller/customer cards, items table, gold accents).
 * M113 (owner, 2026-10-21): EMAIL-SAFE layout — nested tables with inline styles only (mail clients
 * strip flex/grid) and explicit directions on every mixed value; and the invoice follows the
 * CUSTOMER'S app language («لو العميل فاتح من إنجليزي الفاتورة بالكامل إنجليزي») — the app sends
 * x-app-lang with the payment and the stored `lang` picks the whole rendering.
 * M138b (owner, 2026-10-29: «الفاتورة اللي اقصدها توصل للعميل حاجه زي كده… بنفس الشكل ده بالظبط»):
 * the M108 customer invoice IS the template — the royal restyle is gone, and every member receipt
 * (card delivery, HQ booking, service request, workshop, form…) renders through the same document:
 * the same header, meta tiles, seller + customer cards, items table, total bar, note and footer.
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
    receipt: 'إيصال',
    paid: 'مدفوعة بالكامل ✓',
    received: 'تم استلام الطلب ✓',
    doneMark: 'تم التنفيذ ✓',
    invoiceNo: 'رقم الفاتورة',
    requestNo: 'رقم الطلب',
    payDate: 'تاريخ الدفع',
    issueDate: 'تاريخ الإصدار',
    requestDate: 'تاريخ الطلب',
    gateway: 'بوابة الدفع',
    status: 'الحالة',
    kind: 'نوع الطلب',
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
    totalDue: 'الإجمالي',
    noFee: 'بدون رسوم',
    reference: 'مرجع العملية:',
    appName: 'تطبيق نادي المستثمرين',
  },
  en: {
    cr: 'CR No.',
    invoice: 'Invoice',
    receipt: 'Receipt',
    paid: 'PAID IN FULL ✓',
    received: 'REQUEST RECEIVED ✓',
    doneMark: 'COMPLETED ✓',
    invoiceNo: 'Invoice No.',
    requestNo: 'Request No.',
    payDate: 'Payment date',
    issueDate: 'Issue date',
    requestDate: 'Request date',
    gateway: 'Payment gateway',
    status: 'Status',
    kind: 'Request type',
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
    totalDue: 'Total',
    noFee: 'No fees',
    reference: 'Transaction reference:',
    appName: 'The Investors Club app',
  },
} as const satisfies Record<AppLang, Record<string, string>>;

// The M108 palette the owner approved (invoice 10001): navy header and bars, soft blue-grey washes, one gold pill.
const NAVY = '#1F3A6E';
const INK = '#1C2B4A';
const MUTED = '#5A6B8C';
const LINE = '#E1E6F0';
const WASH = '#F4F6FB';
const GOLD = '#F6C445';
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

/** Everything the document template needs — the invoice and the receipts fill it differently. Values are HTML. */
export type InvoiceDocument = {
  lang: AppLang;
  /** The page <title>, also the small line under the document. */
  docTitle: string;
  /** The big heading beside the pill: «فاتورة — تصميم Pitch Deck». */
  heading: string;
  pill: string;
  meta: { label: string; value: string }[];
  customer: { name: string; phone?: string | null; email?: string | null };
  items: { title: string; lines: string[]; amount: string }[];
  discount?: { label: string; amount: string } | null;
  total: { label: string; value: string };
  note: string;
  stampUrl?: string | null;
};

/** The M108 document: nested tables, inline styles, explicit directions — safe in every mail client. */
export function documentHtml(doc: InvoiceDocument): string {
  const lang = doc.lang;
  const t = L[lang];
  const dir = lang === 'en' ? 'ltr' : 'rtl';
  const start = lang === 'en' ? 'left' : 'right';
  const end = lang === 'en' ? 'right' : 'left';
  const sellerName = lang === 'en' ? SELLER.nameEn : SELLER.name;
  const sellerAddress = lang === 'en' ? SELLER.addressEn : SELLER.address;
  const cardRow = (label: string, value: string): string =>
    `<tr><td style="${FONT};font-size:12px;color:${MUTED};padding:5px 0;white-space:nowrap;vertical-align:top">${label}</td><td style="${FONT};font-size:13px;font-weight:600;color:${INK};padding:5px 10px;text-align:${end}">${value}</td></tr>`;
  const itemCell = `padding:12px 14px;border-bottom:1px solid ${LINE};${FONT};font-size:14px;color:${INK};vertical-align:top`;
  const numCell = `padding:12px 14px;border-bottom:1px solid ${LINE};${FONT};font-size:14px;color:${INK};text-align:${end};white-space:nowrap`;
  const items = doc.items
    .map(
      (item) =>
        `<tr><td style="${itemCell}"><strong><bdi>${item.title}</bdi></strong>${item.lines.map((line) => `<div style="color:${MUTED};font-size:12px;margin-top:4px;line-height:1.8"><bdi>${line}</bdi></div>`).join('')}</td><td dir="ltr" style="${numCell}">${item.amount}</td></tr>`,
    )
    .join('');
  const discountRow = doc.discount ? `<tr><td style="${itemCell}"><strong>${doc.discount.label}</strong></td><td dir="ltr" style="${numCell}">${doc.discount.amount}</td></tr>` : '';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${doc.docTitle} — ${escape(SELLER.brand)}</title>
<style>:root{color-scheme:light}@media print{body{background:#fff !important}}</style></head>
<body style="margin:0;padding:0;background:#EEF1F6;${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F6"><tr><td align="center" style="padding:18px 8px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden">

<tr><td style="background:${NAVY};padding:12px 24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="${FONT};color:#FFFFFF;font-size:14px;font-weight:700;white-space:nowrap">${t.cr}: ${ltr(SELLER.cr)}</td>
    <td dir="ltr" style="${FONT};color:#FFFFFF;font-size:13px;text-align:${end};white-space:nowrap">${escape(SELLER.brand)}</td>
  </tr></table>
</td></tr>

<tr><td style="padding:22px 24px 6px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="${FONT};font-size:21px;font-weight:700;color:${NAVY};line-height:1.6"><bdi>${doc.heading}</bdi></td>
    <td align="${end}" style="vertical-align:top;padding-${start}:10px;white-space:nowrap"><span style="${FONT};display:inline-block;background:${GOLD};color:${INK};border-radius:20px;padding:6px 16px;font-weight:700;font-size:13px;white-space:nowrap">${doc.pill}</span></td>
  </tr></table>
</td></tr>

<tr><td style="padding:8px 20px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${doc.meta.map((cell) => metaCell(cell.label, cell.value)).join('\n    ')}
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
          ${cardRow(t.name, `<bdi>${escape(doc.customer.name || '—')}</bdi>`)}
          ${doc.customer.phone ? cardRow(t.phone, ltr(doc.customer.phone)) : ''}
          ${doc.customer.email ? cardRow(t.email, ltr(doc.customer.email)) : ''}
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
    ${items}
    ${discountRow}
  </table>
</td></tr>

<tr><td style="padding:16px 24px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY};border-radius:10px"><tr>
    <td style="${FONT};color:#FFFFFF;font-size:15px;font-weight:700;padding:14px 18px">${doc.total.label}</td>
    <td dir="ltr" style="${FONT};color:#FFFFFF;font-size:19px;font-weight:800;padding:14px 18px;text-align:${end};white-space:nowrap">${doc.total.value}</td>
  </tr></table>
</td></tr>

<tr><td style="padding:14px 24px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8E6;border:1px solid ${GOLD};border-radius:10px"><tr>
    <td style="${FONT};font-size:12.5px;color:#5A4A12;padding:12px 16px;line-height:1.9">${doc.note}</td>
  </tr></table>
</td></tr>

${doc.stampUrl ? `<tr><td align="center" style="padding:18px 24px 6px"><img src="${doc.stampUrl}" width="128" height="128" alt="${escape(SELLER.brand)}" style="display:block;width:128px;height:128px;opacity:0.92"></td></tr>` : ''}

<tr><td style="background:${NAVY};padding:14px 24px;margin-top:20px">
  <div dir="ltr" style="${FONT};color:#FFFFFF;font-size:12.5px;text-align:center;line-height:2">
    <span style="color:#FFFFFF">${escape(SELLER.addressEn)}</span><br>
    ${SELLER.phones.map((phone) => `<a href="tel:${escape(phone)}" style="color:#FFFFFF;text-decoration:none">${escape(phone)}</a>`).join(' · ')}
    · <a href="https://${escape(SELLER.site)}" style="color:#FFFFFF;text-decoration:none">${escape(SELLER.site)}</a>
    · <a href="mailto:${escape(SELLER.email)}" style="color:#FFFFFF;text-decoration:none">${escape(SELLER.email)}</a>
  </div>
</td></tr>

</table>
<div style="${FONT};font-size:11px;color:${MUTED};padding:10px 0">${t.appName} — ${doc.docTitle}</div>
</td></tr></table>
</body></html>`;
}

/** Full printable HTML document; also the body of the customer mail.
 * `publicUrl` lets the company stamp render (served at /pay/invoice-stamp.png). */
export function invoiceHtml(payment: Payment, invoiceNo: number, lang: AppLang = 'ar', publicUrl?: string): string {
  const t = L[lang];
  const gateway = GATEWAY_LABEL[lang][payment.provider] ?? payment.provider;
  const baseAmount = payment.preDiscountSar && payment.preDiscountSar > payment.amount ? payment.preDiscountSar : payment.amount;
  const answers = payment.answers
    .filter((answer) => answer.key !== 'discount')
    .map((answer) => `${escape(answer.label)}: ${escape(answer.value)}`)
    .join(' · ');
  const discount =
    payment.discountCode && payment.preDiscountSar && payment.preDiscountSar > payment.amount
      ? {
          label: `${t.discountBy} <span dir="ltr">${escape(payment.discountCode)}</span>${payment.discountPercent ? ` (${payment.discountPercent}%)` : ''}`,
          amount: `&minus;${money(payment.preDiscountSar - payment.amount)}`,
        }
      : null;
  const note =
    lang === 'en'
      ? `This invoice was issued electronically by ${t.appName} — <span dir="ltr">Vibes Ventures</span> and confirms full payment of the amount above through <bdi>${escape(gateway)}</bdi>.`
      : `صدرت هذه الفاتورة إلكترونيًا من ${t.appName} — <span dir="ltr">Vibes Ventures</span> وتثبت سداد المبلغ المذكور أعلاه بالكامل عبر بوابة <bdi>${escape(gateway)}</bdi>.`;
  return documentHtml({
    lang,
    docTitle: invoiceTitle(invoiceNo, lang),
    heading: `${t.invoice} — ${escape(payment.serviceTitle)}`,
    pill: t.paid,
    meta: [
      { label: t.invoiceNo, value: ltr(String(invoiceNo)) },
      { label: t.payDate, value: day(payment.paidAt, lang) },
      { label: t.issueDate, value: day(payment.paidAt ?? payment.createdAt, lang) },
      { label: t.gateway, value: `<bdi>${escape(gateway)}</bdi>` },
    ],
    customer: { name: payment.name, phone: payment.phone, email: payment.email },
    items: [{ title: escape(payment.serviceTitle), lines: [...(answers ? [answers] : []), ...(payment.memberPrice ? [t.memberPrice] : [])], amount: money(baseAmount) }],
    discount,
    total: { label: t.total, value: `SAR ${money(payment.amount)}` },
    note: `${note}${payment.transactionId ? ` ${t.reference} ${ltr(payment.transactionId)}` : ''}`,
    stampUrl: publicUrl ? `${publicUrl}/pay/invoice-stamp.png` : null,
  });
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

/** «إيصال رقم …» — the member quotes the request number. */
export function receiptTitle(entry: MemberRequest, lang: AppLang = 'ar'): string {
  return lang === 'en' ? `Receipt No. ${entry.number}` : `إيصال رقم ${entry.number}`;
}

export type ReceiptCustomer = { name: string; email?: string | null; phone?: string | null };

/**
 * M138b: a member request as the SAME customer document — heading «إيصال — توصيل كارت العضوية», the pill
 * «تم استلام الطلب ✓» (or «تم التنفيذ ✓»), four tiles (رقم الطلب / تاريخ الطلب / الحالة / النوع), the seller
 * and customer cards, the request as the one item with its details, and the total bar reading «بدون رسوم»
 * whenever no payment was involved (rule 3: membership itself is never invoiced here).
 */
export function receiptHtml(entry: MemberRequest, customer: ReceiptCustomer, lang: AppLang = 'ar', publicUrl?: string): string {
  const t = L[lang];
  const en = lang === 'en';
  const title = en ? entry.titleEn : entry.title;
  const fee = entry.amountSar !== null && !entry.noFee ? `SAR ${money(entry.amountSar)}` : t.noFee;
  const lines = entry.rows.map((row) => `${escape(en ? row.labelEn : row.label)}: ${escape(row.value)}`);
  const done = entry.status === 'done';
  const base = en
    ? `This receipt was issued electronically by ${t.appName} — <span dir="ltr">Vibes Ventures</span> and confirms that your request was received. You will be notified at every update, and you can follow it in the app under «My requests».`
    : `صدر هذا الإيصال إلكترونيًا من ${t.appName} — <span dir="ltr">Vibes Ventures</span> ويثبت استلام طلبك. ستصلك رسالة عند كل تحديث، ويمكنك متابعته من التطبيق: حسابي ← متابعة طلباتي.`;
  const cardNote = entry.kind === 'card' ? (en ? ' This receipt covers the delivery request only; it is not a membership invoice.' : ' هذا الإيصال خاص بطلب التوصيل فقط وليس فاتورة عضوية.') : '';
  return documentHtml({
    lang,
    docTitle: receiptTitle(entry, lang),
    heading: `${t.receipt} — ${escape(title)}`,
    pill: done ? t.doneMark : t.received,
    meta: [
      { label: t.requestNo, value: ltr(entry.number) },
      { label: t.requestDate, value: day(entry.createdAt, lang) },
      { label: t.status, value: `<bdi>${escape(statusLabel(entry.status, lang))}</bdi>` },
      { label: t.kind, value: `<bdi>${escape(kindLabel(entry.kind, lang))}</bdi>` },
    ],
    customer,
    items: [{ title: escape(title), lines, amount: entry.amountSar !== null && !entry.noFee ? money(entry.amountSar) : t.noFee }],
    total: { label: entry.amountSar !== null && !entry.noFee ? t.total : t.totalDue, value: fee },
    note: `${base}${cardNote}`,
    stampUrl: publicUrl ? `${publicUrl}/pay/invoice-stamp.png` : null,
  });
}

/** The plain-text twin of the receipt mail. */
export function receiptText(entry: MemberRequest, lang: AppLang = 'ar', appUrl?: string): string {
  const en = lang === 'en';
  const title = en ? entry.titleEn : entry.title;
  const fee = entry.amountSar !== null && !entry.noFee ? `SAR ${money(entry.amountSar)}` : L[lang].noFee;
  const details = entry.rows.map((row) => `${en ? row.labelEn : row.label}: ${row.value}`);
  return [
    `${receiptTitle(entry, lang)} — ${title}`,
    `${L[lang].kind}: ${kindLabel(entry.kind, lang)}`,
    `${L[lang].status}: ${statusLabel(entry.status, lang)}`,
    ...details,
    `${L[lang].totalDue}: ${fee}`,
    `${en ? 'Seller' : 'البائع'}: ${en ? SELLER.nameEn : SELLER.name} — ${en ? 'CR' : 'سجل تجاري'} ${SELLER.cr}`,
    ...(appUrl ? [en ? `Track my requests: ${appUrl}` : `متابعة طلباتي: ${appUrl}`] : []),
    en ? 'Thank you for being with The Investors Club.' : 'شكرًا لوجودك معنا في نادي المستثمرين.',
  ].join('\n');
}
