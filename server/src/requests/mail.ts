import type { AppLang } from '../lang.js';
import { riyadhDateTime, riyadhDateTimeEn } from '../mail/notify.js';
import type { RoyalMail, RoyalRow } from '../mail/royal.js';
import { kindLabel, statusLabel, type MemberRequest, type RequestStatus } from './model.js';

/**
 * M138: the member's own mails, in the royal shell (M156) — a receipt the moment he asks for
 * anything, and a short notice on every status change. The card delivery reads as a no-fee
 * receipt («بدون رسوم», never a bare zero — rule 3: membership is never invoiced here).
 */
export type MemberMail = { subject: string; mail: RoyalMail };

const NO_FEE = { ar: 'بدون رسوم', en: 'No fees' };

function when(iso: string, lang: AppLang): string {
  return lang === 'en' ? riyadhDateTimeEn(iso) : riyadhDateTime(iso);
}

function detailRows(entry: MemberRequest, lang: AppLang): RoyalRow[] {
  return entry.rows.map((row) => ({ label: lang === 'en' ? row.labelEn : row.label, value: row.value }));
}

function amountRow(entry: MemberRequest, lang: AppLang): RoyalRow[] {
  if (entry.noFee) return [{ label: lang === 'en' ? 'Amount' : 'المبلغ', value: NO_FEE[lang === 'en' ? 'en' : 'ar'] }];
  if (entry.amountSar !== null) return [{ label: lang === 'en' ? 'Amount' : 'المبلغ', value: `${entry.amountSar} SAR`, ltr: true }];
  return [];
}

export function receiptMail(entry: MemberRequest, name: string, lang: AppLang, appUrl: string): MemberMail {
  const en = lang === 'en';
  const title = en ? entry.titleEn : entry.title;
  const kind = kindLabel(entry.kind, lang);
  const rows: RoyalRow[] = [
    { label: en ? 'Request no.' : 'رقم الطلب', value: entry.number, ltr: true },
    { label: en ? 'Type' : 'النوع', value: kind },
    { label: en ? 'Request' : 'الطلب', value: title },
    ...amountRow(entry, lang),
    ...detailRows(entry, lang),
    { label: en ? 'Received' : 'تاريخ الاستلام', value: when(entry.createdAt, lang) },
    { label: en ? 'Status' : 'الحالة', value: statusLabel(entry.status, lang) },
  ];
  const card = entry.kind === 'card';
  const greeting = name.trim() ? (en ? `Dear ${name.trim()},` : `أهلًا بك يا ${name.trim()}،`) : en ? 'Dear member,' : 'أهلًا بك،';
  if (card) {
    return {
      subject: en ? `Receipt — membership card delivery (No. ${entry.number})` : `إيصال طلب توصيل كارت العضوية (رقم ${entry.number})`,
      mail: {
        lang,
        eyebrow: en ? 'RECEIPT · INVESTORS CLUB' : 'إيصال · INVESTORS CLUB',
        title: en ? 'Membership card delivery' : 'توصيل كارت العضوية',
        subtitle: en ? `Receipt No. ${entry.number} · ${NO_FEE.en}` : `إيصال رقم ${entry.number} · ${NO_FEE.ar}`,
        greeting,
        lead: [
          en
            ? 'We received your request for a printed membership card delivered to your address. Printing and delivery carry no fees. You will be notified when it is on its way.'
            : 'استلمنا طلبك لنسخة مطبوعة من كارت عضويتك تصلك إلى عنوانك. الطباعة والتوصيل بدون رسوم، وستصلك رسالة عند إرساله.',
        ],
        rows,
        cta: { label: en ? 'Track my requests' : 'متابعة طلباتي', url: appUrl },
        note: en
          ? 'This receipt covers the delivery request only; it is not a membership invoice.'
          : 'هذا الإيصال خاص بطلب التوصيل فقط وليس فاتورة عضوية.',
      },
    };
  }
  return {
    subject: en ? `We received your request — ${kind} (No. ${entry.number})` : `استلمنا طلبك — ${kind} (رقم ${entry.number})`,
    mail: {
      lang,
      title: en ? 'We received your request' : 'استلمنا طلبك',
      subtitle: kind,
      greeting,
      lead: [
        entry.status === 'done'
          ? en
            ? 'Your request is confirmed. Its details are below, and you can review it any time in the app under «My requests».'
            : 'تم تأكيد طلبك. تفاصيله أدناه، ويمكنك مراجعته في أي وقت من التطبيق: حسابي ← متابعة طلباتي.'
          : en
            ? 'The club team will follow it up. You will get a message at every update, and you can track it in the app under «My requests».'
            : 'سيتابعه فريق النادي، وستصلك رسالة عند كل تحديث. يمكنك متابعة الحالة من التطبيق: حسابي ← متابعة طلباتي.',
      ],
      rows,
      cta: { label: en ? 'Track my requests' : 'متابعة طلباتي', url: appUrl },
    },
  };
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
