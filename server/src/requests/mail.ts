import type { AppLang } from '../lang.js';
import { receiptHtml, receiptText, type ReceiptCustomer } from '../payments/invoice.js';
import { riyadhDateTime, riyadhDateTimeEn } from '../mail/notify.js';
import type { RoyalMail, RoyalRow } from '../mail/royal.js';
import { kindLabel, statusLabel, type MemberRequest, type RequestStatus } from './model.js';

/**
 * M138: the member's own mails, in the royal shell (M156) — a receipt the moment he asks for
 * anything, and a short notice on every status change. The card delivery reads as a no-fee
 * receipt («بدون رسوم», never a bare zero — rule 3: membership is never invoiced here).
 */
export type MemberMail = { subject: string; mail: RoyalMail };
/** M138b: the receipt is the M108 customer invoice document, ready to send (HTML + text). */
export type MemberDocument = { subject: string; html: string; text: string };

function when(iso: string, lang: AppLang): string {
  return lang === 'en' ? riyadhDateTimeEn(iso) : riyadhDateTime(iso);
}

/**
 * M138b (owner, 2026-10-29: «الفاتورة اللي اقصدها توصل للعميل حاجه زي كده… بنفس الشكل ده بالظبط»): the receipt
 * for every member action is the SAME document as the M108 customer invoice (payments/invoice.ts) — the card
 * delivery and every other no-payment request read «بدون رسوم» (never a bare zero; rule 3).
 */
export function receiptMail(entry: MemberRequest, customer: ReceiptCustomer, lang: AppLang, appUrl: string, publicUrl?: string): MemberDocument {
  const en = lang === 'en';
  const kind = kindLabel(entry.kind, lang);
  const subject =
    entry.kind === 'card'
      ? en
        ? `Receipt — membership card delivery (No. ${entry.number})`
        : `إيصال طلب توصيل كارت العضوية (رقم ${entry.number})`
      : en
        ? `We received your request — ${kind} (No. ${entry.number})`
        : `استلمنا طلبك — ${kind} (رقم ${entry.number})`;
  return { subject, html: receiptHtml(entry, customer, lang, publicUrl), text: receiptText(entry, lang, appUrl) };
}

export const CHANGE_TITLE: Record<RequestStatus, { ar: string; en: string }> = {
  pending: { ar: 'طلبك قيد المراجعة', en: 'Your request is under review' },
  in_progress: { ar: 'طلبك جارٍ تنفيذه', en: 'Your request is in progress' },
  done: { ar: 'تم تنفيذ طلبك', en: 'Your request is done' },
  rejected: { ar: 'تعذّر تنفيذ طلبك', en: 'Your request could not be completed' },
  cancelled: { ar: 'أُلغي طلبك', en: 'Your request was cancelled' },
};

export function changeMail(entry: MemberRequest, name: string, lang: AppLang, appUrl: string): MemberMail {
  const en = lang === 'en';
  const title = CHANGE_TITLE[entry.status][en ? 'en' : 'ar'];
  const kind = kindLabel(entry.kind, lang);
  const greeting = name.trim() ? (en ? `Dear ${name.trim()},` : `أهلًا بك يا ${name.trim()}،`) : en ? 'Dear member,' : 'أهلًا بك،';
  const rows: RoyalRow[] = [
    { label: en ? 'Request no.' : 'رقم الطلب', value: entry.number, ltr: true },
    { label: en ? 'Type' : 'النوع', value: kind },
    { label: en ? 'Request' : 'الطلب', value: en ? entry.titleEn : entry.title },
    { label: en ? 'Status' : 'الحالة', value: statusLabel(entry.status, lang) },
    ...(entry.note ? [{ label: en ? 'Note from the club' : 'ملاحظة الإدارة', value: entry.note }] : []),
    { label: en ? 'Updated' : 'تاريخ التحديث', value: when(entry.updatedAt ?? new Date().toISOString(), lang) },
  ];
  const lead =
    entry.status === 'done'
      ? en
        ? 'Thank you for being with the Investors Club.'
        : 'شكرًا لوجودك معنا في نادي المستثمرين.'
      : entry.status === 'rejected'
        ? en
          ? 'If you have a question about this decision, write to the club from the app («Contact the club»).'
          : 'إن كان لديك استفسار عن هذا القرار فراسل الإدارة من التطبيق («راسل الإدارة»).'
        : en
          ? 'You will get another message when it is done.'
          : 'ستصلك رسالة أخرى عند اكتماله.';
  return {
    subject: `${title} — ${kind} (${en ? 'No.' : 'رقم'} ${entry.number})`,
    mail: { lang, title, subtitle: kind, greeting, lead: [lead], rows, cta: { label: en ? 'Track my requests' : 'متابعة طلباتي', url: appUrl } },
  };
}
