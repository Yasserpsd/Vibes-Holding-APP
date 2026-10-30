import type { FastifyBaseLogger } from 'fastify';

import type { Mailer } from './mailer.js';
import { royalHtml, royalText, type RoyalMail } from './royal.js';

/**
 * Management notifications: one plain-text Arabic e-mail per action, in the style of the website's
 * own notifications (subject prefix [Vibes Ventures], Riyadh time), sent to the NOTIFY_EMAIL list.
 * Sending never blocks or fails a request: mails go out in the background and errors are logged.
 */
const SUBJECT_PREFIX = '[Vibes Ventures]';
const APP_NAME = 'تطبيق نادي المستثمرين';
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const riyadhFormat = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  timeZone: 'Asia/Riyadh',
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dayFormat = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });

export function riyadhDateTime(value: string | number | Date): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : riyadhFormat.format(date);
}

/** «الأحد 20 سبتمبر 2026» for a YYYY-MM-DD date. */
export function arabicDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${WEEKDAYS[parsed.getUTCDay()]} ${dayFormat.format(parsed)}`;
}

export function formatAmount(amount: number, currency: string): string {
  return `${new Intl.NumberFormat('en-US').format(amount)} ${currency === 'SAR' ? 'ريال' : currency}`;
}

// M122: the same helpers in English, for the member pushes of English-language devices.
const riyadhFormatEn = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Riyadh',
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dayFormatEn = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

export function riyadhDateTimeEn(value: string | number | Date): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : riyadhFormatEn.format(date);
}

/** "Sunday 20 September 2026" for a YYYY-MM-DD date. */
export function englishDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : dayFormatEn.format(parsed);
}

export function formatAmountEn(amount: number, currency: string): string {
  return `${new Intl.NumberFormat('en-US').format(amount)} ${currency}`;
}

type Person = { name: string; phone: string; email: string };
type Answer = { label: string; value: string };

export type VisitLike = Person & {
  id: string;
  date: string;
  time: string;
  endTime: string;
  purpose: string;
  note: string;
  createdAt: string;
  adminNote: string | null;
};

export type PaymentLike = Person & {
  id: string;
  serviceTitle: string;
  amount: number;
  currency: string;
  memberPrice: boolean;
  answers: Answer[];
  provider: string;
  createdAt: string;
  transactionId: string | null;
  failureReason: string | null;
};

export type ServiceRequestLike = { serviceTitle: string; answers: Answer[]; sender: Person | null; channel: string };

export type ActivationLike = {
  contactId: number;
  name: string;
  email: string;
  phone: string;
  productId: string;
  store: string;
  reference: string;
  days: number;
  expiresAt: string | null;
  environment: string;
  /** M156: the real address of an Apple-relay account (hub 2.26.0), '' when none. */
  contactEmail?: string;
  /** M156: the member's language for his own mail. */
  lang?: 'ar' | 'en';
  /** M156: the number on the membership card. */
  cardNumber?: string;
};

export type NotifierDeps = { mailer: Mailer; recipients: string[]; log: FastifyBaseLogger; appEnv: 'test' | 'production'; publicUrl?: string };

/** The store as a member reads it on his mail. */
function storeLabel(store: string, lang: 'ar' | 'en'): string {
  const key = store.toUpperCase();
  if (key === 'APP_STORE') return lang === 'en' ? 'Apple App Store' : 'متجر Apple App Store';
  if (key === 'PLAY_STORE') return lang === 'en' ? 'Google Play' : 'متجر Google Play';
  if (key === 'PAYMOB_LINK' || key === 'MOYASAR' || key === 'PAYMOB') return lang === 'en' ? 'online payment' : 'الدفع الإلكتروني';
  return store;
}

function personLines(person: Person | null): string[] {
  if (!person) return ['المرسل: زائر بدون حساب'];
  return [`الاسم: ${person.name || '—'}`, `الجوال: ${person.phone || '—'}`, `البريد: ${person.email || '—'}`];
}

function answerLines(answers: Answer[]): string[] {
  return answers.filter((answer) => answer.value.trim()).map((answer) => `${answer.label}: ${answer.value.trim()}`);
}

function gatewayName(provider: string): string {
  if (provider === 'code') return 'بدون بوابة — كود خصم 100%';
  if (provider === 'moyasar') return 'ميسر (Moyasar)';
  return provider === 'mock' ? 'تجريبية (بدون بوابة حقيقية)' : 'Paymob';
}

export class Notifier {
  /** The active list: the variable's at construction, the dashboard's once one is saved (M16). */
  private recipients: string[];

  constructor(private readonly deps: NotifierDeps) {
    this.recipients = deps.recipients;
  }

  setRecipients(recipients: string[]): void {
    this.recipients = recipients;
  }

  get configured(): boolean {
    return this.deps.mailer.configured && this.recipients.length > 0;
  }

  status(): { configured: boolean; recipients: number } {
    return { configured: this.configured, recipients: this.recipients.length };
  }

  private dispatch(subject: string, lines: (string | null)[], html?: string): void {
    const fullSubject = `${SUBJECT_PREFIX}${this.deps.appEnv === 'test' ? ' [تجريبي]' : ''} ${subject}`;
    const body = lines.filter((line): line is string => line !== null);
    const text = [...body, '', `التاريخ: ${riyadhDateTime(Date.now())} (الرياض)`, `المصدر: ${APP_NAME}`].join('\n');
    if (!this.recipients.length) {
      this.deps.log.info({ subject: fullSubject }, 'notification skipped: no recipients (NOTIFY_EMAIL or the dashboard list)');
      return;
    }
    this.deps.mailer
      .send({ to: this.recipients, subject: fullSubject, text, ...(html ? { html } : {}) })
      .then((sent) => this.deps.log.info({ subject: fullSubject, sent }, 'notification'))
      .catch((error: unknown) => this.deps.log.error({ err: error, subject: fullSubject }, 'notification mail failed'));
  }

  /** M156: a royal (HTML + text) mail to ONE member, in his language; the [تجريبي] mark in the test environment only. */
  private sendRoyal(to: string, subject: string, mail: RoyalMail, what: string): void {
    const address = to.trim();
    if (!address) {
      this.deps.log.warn({ what }, 'member mail skipped: no address');
      return;
    }
    const fullSubject = `${this.deps.appEnv === 'test' ? '[تجريبي] ' : ''}${subject}`;
    const seal = this.deps.publicUrl ? { sealUrl: `${this.deps.publicUrl}/pay/invoice-stamp.png` } : {};
    this.deps.mailer
      .send({ to: [address], subject: fullSubject, text: royalText(mail), html: royalHtml({ ...mail, ...seal }) })
      .then((sent) => this.deps.log.info({ subject: fullSubject, sent, what }, 'member mail'))
      .catch((error: unknown) => this.deps.log.error({ err: error, subject: fullSubject, what }, 'member mail failed'));
  }

  /** M138: one royal mail to a member — the receipts and status notices built in requests/mail.ts. */
  memberMail(to: string, subject: string, mail: RoyalMail, what: string): void {
    this.sendRoyal(to, subject, mail, what);
  }

  /** M138b: a ready document (the M108 invoice layout) to ONE member — the receipts built in requests/mail.ts. */
  memberDocument(to: string, subject: string, html: string, text: string, what: string): void {
    const address = to.trim();
    if (!address) {
      this.deps.log.warn({ what }, 'member mail skipped: no address');
      return;
    }
    const fullSubject = `${this.deps.appEnv === 'test' ? '[تجريبي] ' : ''}${subject}`;
    this.deps.mailer
      .send({ to: [address], subject: fullSubject, text, html })
      .then((sent) => this.deps.log.info({ subject: fullSubject, sent, what }, 'member mail'))
      .catch((error: unknown) => this.deps.log.error({ err: error, subject: fullSubject, what }, 'member mail failed'));
  }

  hqVisitRequested(visit: VisitLike): void {
    this.dispatch(`حجز زيارة للمقر من التطبيق: ${visit.name}`, [
      `طلب العضو حجز زيارة لمقر النادي من ${APP_NAME}.`,
      '',
      ...personLines(visit),
      `يوم الزيارة: ${arabicDay(visit.date)}`,
      `الوقت: من ${visit.time} إلى ${visit.endTime}`,
      `الغرض: ${visit.purpose}`,
      visit.note ? `ملاحظة العضو: ${visit.note}` : null,
      `تاريخ الحجز: ${riyadhDateTime(visit.createdAt)} (الرياض)`,
      `رقم الحجز: ${visit.id}`,
      '',
      'الحالة: بانتظار تأكيد الإدارة. التأكيد أو الرفض من التطبيق: حسابي ← طلبات زيارة المقر (إدارة).',
    ]);
  }

  hqVisitCancelled(visit: VisitLike): void {
    this.dispatch(`إلغاء زيارة للمقر من التطبيق: ${visit.name}`, [
      `ألغى العضو حجز زيارته لمقر النادي من ${APP_NAME}.`,
      '',
      ...personLines(visit),
      `يوم الزيارة: ${arabicDay(visit.date)}`,
      `الوقت: من ${visit.time} إلى ${visit.endTime}`,
      `الغرض: ${visit.purpose}`,
      `رقم الحجز: ${visit.id}`,
    ]);
  }

  hqVisitDecided(visit: VisitLike, status: 'confirmed' | 'rejected', adminName: string): void {
    this.dispatch(`${status === 'confirmed' ? 'تأكيد' : 'رفض'} زيارة للمقر: ${visit.name}`, [
      `${status === 'confirmed' ? 'أكدت' : 'رفضت'} الإدارة (${adminName}) حجز زيارة لمقر النادي من ${APP_NAME}.`,
      status === 'confirmed' ? 'صدر للعضو باركود دخول صالح لهذا الموعد فقط.' : null,
      '',
      ...personLines(visit),
      `يوم الزيارة: ${arabicDay(visit.date)}`,
      `الوقت: من ${visit.time} إلى ${visit.endTime}`,
      `الغرض: ${visit.purpose}`,
      visit.adminNote ? `ملاحظة الإدارة: ${visit.adminNote}` : null,
      `رقم الحجز: ${visit.id}`,
    ]);
  }

  /** M32: an invited registration confirmed its e-mail — the administration prepares the gift by hand. */
  inviteVerified(invite: { id: string; inviteeName: string; inviteePhone: string; inviteeEmail: string; inviterName: string; inviterNumber: string }): void {
    this.dispatch(`تسجيل جديد بدعوة عضو: ${invite.inviteeName}`, [
      `سجّل عضو جديد في ${APP_NAME} بكود دعوة أحد الأعضاء وفعّل بريده، والهدية عليه من الإدارة (تحددونها وتسلّمونها بأنفسكم).`,
      '',
      `العضو الجديد: ${invite.inviteeName || '—'}`,
      `جواله: ${invite.inviteePhone || '—'}`,
      `بريده: ${invite.inviteeEmail || '—'}`,
      '',
      `الداعي: ${invite.inviterName || '—'}`,
      `رقم عضوية الداعي: ${invite.inviterNumber}`,
      '',
      'القائمة الكاملة في لوحة الإدارة: قسم «الدعوات». عند تسليم الهدية اضغط «تم تسليم الهدية» واكتب ما سلّمتموه.',
    ]);
  }

  /** M8: the web deletion page (legal/) — the deletion itself stays a verified manual step, never automatic. */
  accountDeletionRequested(request: { email: string; name: string; phone: string; note: string; ip: string }): void {
    this.dispatch(`طلب حذف حساب من صفحة الويب: ${request.email}`, [
      `وصل طلب حذف حساب من صفحة «حذف الحساب» العامة (وليس من داخل ${APP_NAME}).`,
      'مطلوب: التحقق من ملكية الحساب عبر البريد المسجل ثم تنفيذ الحذف خلال 30 يومًا كحد أقصى والرد على صاحبه.',
      '',
      `البريد المكتوب في الطلب: ${request.email}`,
      request.name ? `الاسم: ${request.name}` : null,
      request.phone ? `الجوال: ${request.phone}` : null,
      request.note ? `ملاحظة صاحب الطلب: ${request.note}` : null,
      `عنوان IP: ${request.ip}`,
      '',
      'تنبيه: النموذج عام ولا يتحقق من هوية المرسل — لا تحذفوا حسابًا قبل تأكيد صاحبه من بريده المسجل.',
    ]);
  }

  /** M30: a member asked for his membership card printed and delivered (his own choice, no charge). */
  cardPrintRequested(request: { id: string; name: string; phone: string; email: string; cardNumber: string; personaLabel: string; city: string; address: string; note: string; method?: 'pickup' | 'delivery' }): void {
    this.dispatch(`طلب طباعة كارت العضوية: ${request.name}`, [
      // M162: pickup at the HQ is free; delivery carries shipping fees by region (the management quotes them).
      request.method === 'pickup'
        ? `طلب العضو نسخة مطبوعة من كارت عضويته يستلمها من مقر النادي بدون رسوم (من ${APP_NAME}).`
        : `طلب العضو نسخة مطبوعة من كارت عضويته تُوصَّل إلى عنوانه، ومصاريف الشحن حسب المنطقة تُحدَّد له قبل الإرسال (من ${APP_NAME}).`,
      '',
      ...personLines(request),
      `رقم العضوية: ${request.cardNumber}`,
      request.personaLabel ? `الفئة: ${request.personaLabel}` : null,
      `المدينة: ${request.city}`,
      `العنوان: ${request.address}`,
      request.note ? `ملاحظة العضو: ${request.note}` : null,
      `رقم الطلب: ${request.id}`,
      '',
      'القائمة الكاملة في لوحة الإدارة: قسم «طلبات الكروت». عند التسليم علّم الطلب «تم التسليم».',
    ]);
  }

  /** M36: a member wrote to the management in «راسل الإدارة» and waits for an answer. */
  memberMessage(member: { name: string; phone: string; email: string; cardNumber: string; personaLabel: string }, text: string): void {
    this.dispatch(`رسالة جديدة من عضو: ${member.name || '—'}`, [
      `بعث أحد الأعضاء رسالة إلى الإدارة من ${APP_NAME} وينتظر الرد.`,
      '',
      ...personLines(member),
      member.cardNumber ? `رقم العضوية: ${member.cardNumber}` : null,
      member.personaLabel ? `الفئة: ${member.personaLabel}` : null,
      '',
      `نص الرسالة:`,
      text,
      '',
      'الرد من لوحة الإدارة: قسم «رسائل الأعضاء». الرد يصل للعضو داخل التطبيق مع إشعار.',
    ]);
  }

  /** M11: a member applied (or re-applied) to «شخصية ومسيرة» and waits for the review. */
  profileApplied(member: { name: string; phone: string; email: string; memberNumber: string; resubmission: boolean }): void {
    this.dispatch(`طلب جديد في «شخصية ومسيرة»: ${member.name || '—'}`, [
      member.resubmission
        ? `عدّل أحد الأعضاء ملفه المعتمد في «شخصية ومسيرة» من ${APP_NAME}؛ النسخة المعتمدة ما زالت الظاهرة والتعديل بانتظار المراجعة.`
        : `قدّم أحد الأعضاء ملفه في «شخصية ومسيرة» من ${APP_NAME} وينتظر الاعتماد.`,
      '',
      ...personLines(member),
      member.memberNumber ? `رقم العضوية: ${member.memberNumber}` : null,
      '',
      'المراجعة من لوحة الإدارة: قسم «شخصية ومسيرة» — اعتماد أو رفض مع سبب، ويمكن تعديل النص وإضافة الصورة قبل الاعتماد.',
    ]);
  }

  /** M41: a CONFIRMED attendance registration in «أجندة النادي» (members at once; fee payers after the webhook). */
  agendaRegistered(
    registration: { id: string; name: string; phone: string; email: string; personaLabel: string; attendance: 'hq' | 'online'; member: boolean; paid: boolean; paymentId: string | null },
    event: { title: string; date: string; time: string; place: string; feeSar: number },
  ): void {
    this.dispatch(`تسجيل حضور: ${event.title} — ${registration.name || '—'}`, [
      `سجّل ${registration.member ? 'عضو' : 'مستخدم'} حضوره في فعالية من «أجندة النادي» في ${APP_NAME}.`,
      '',
      `الفعالية: ${event.title}`,
      `الموعد: ${event.date}${event.time ? ` · ${event.time}` : ''}`,
      event.place ? `المكان: ${event.place}` : null,
      `طريقة الحضور: ${registration.attendance === 'hq' ? 'حضوري في المقر' : 'أونلاين'}`,
      registration.member ? 'الرسوم: عضو — بدون رسوم' : event.feeSar > 0 ? `الرسوم: ${event.feeSar} ريال — مدفوعة داخل التطبيق (رقم العملية ${registration.paymentId ?? '—'})` : 'الرسوم: بدون رسوم',
      '',
      ...personLines(registration),
      registration.personaLabel ? `الفئة: ${registration.personaLabel}` : null,
      `رقم التسجيل: ${registration.id}`,
      '',
      'القائمة الكاملة في لوحة الإدارة: قسم «أجندة النادي» — افتح الفعالية لترى كل المسجّلين.',
    ]);
  }

  /** M44: a payment-link sale was PAID — the mail says exactly what, who, and what happened to the activation. */
  payLinkPaid(
    link: { kind: 'membership' | 'workshop' | 'other'; label: string; amountSar: number; days: number | null; contactId: number | null; contactName: string; customer: { name: string; phone: string; email: string }; paymentId: string; activation: string; activationNote: string | null },
    payment: { transactionId: string | null },
    memberEnd: string,
  ): void {
    const kindLabel = link.kind === 'membership' ? 'عضوية سنوية' : link.kind === 'workshop' ? 'ورشة / فعالية' : 'أخرى';
    const who = link.customer.name || link.contactName || '—';
    this.dispatch(`✅ دفعة ${kindLabel}: ${link.label} — ${who} (${link.amountSar} ريال)`, [
      `دفعة ناجحة عبر رابط دفع أنشأته الإدارة من اللوحة — النوع والعميل معروفان بالكامل.`,
      '',
      `النوع: ${kindLabel}`,
      `الوصف: ${link.label}`,
      `المبلغ: ${link.amountSar} ريال`,
      '',
      `العميل: ${who}`,
      link.customer.phone ? `جواله: ${link.customer.phone}` : null,
      link.customer.email ? `بريده: ${link.customer.email}` : null,
      payment.transactionId ? `رقم عملية البوابة: ${payment.transactionId}` : null,
      `رقم العملية عندنا: ${link.paymentId}`,
      '',
      link.kind !== 'membership'
        ? 'التفعيل: لا يلزم — بيع بلا عضوية.'
        : link.activation === 'done'
          ? `التفعيل: ✅ تم تفعيل العضوية تلقائيًا لحساب ${link.contactName || `#${link.contactId}`}${memberEnd ? ` حتى ${memberEnd}` : ''} — لا شيء عليك.`
          : `التفعيل: ⚠️ لم يتم تلقائيًا (${link.activationNote ?? 'راجع الهاب'}) — فعّل يدويًا من لوحة الأعضاء.`,
    ]);
  }

  /** M44: a payment-link attempt failed at the gateway. */
  payLinkFailed(link: { kind: string; label: string; amountSar: number; customer: { name: string } }, payment: { failureReason: string | null }): void {
    this.dispatch(`❌ محاولة دفع لم تكتمل: ${link.label} (${link.amountSar} ريال)`, [
      `محاولة دفع عبر رابط الإدارة لم تنجح${link.customer.name ? ` — العميل: ${link.customer.name}` : ''}.`,
      payment.failureReason ? `سبب البوابة: ${payment.failureReason}` : null,
      'الرابط ما زال صالحًا: يمكن للعميل المحاولة مرة أخرى بنفس الرابط.',
    ]);
  }

  /** M10: someone registered his interest in a workshop from the guide page. */
  workshopRegistered(registration: { id: string; workshopTitle: string; name: string; phone: string; email: string; personaLabel: string; note: string }): void {
    this.dispatch(`تسجيل في ورشة: ${registration.workshopTitle} — ${registration.name || '—'}`, [
      `سجّل أحد مستخدمي ${APP_NAME} اهتمامه بحضور ورشة من صفحة «دليل المحايد».`,
      '',
      `الورشة: ${registration.workshopTitle}`,
      ...personLines(registration),
      registration.personaLabel ? `الفئة: ${registration.personaLabel}` : null,
      registration.note ? `ملاحظته: ${registration.note}` : null,
      `رقم التسجيل: ${registration.id}`,
      '',
      'القائمة الكاملة في لوحة الإدارة: قسم «تسجيلات الورش». تفاصيل الموعد والحضور ترسلها الإدارة بنفسها للمسجّلين.',
    ]);
  }

  /** M16: a registration form (شركاء النجاح, the workshop…) was filled inside the app. */
  formSubmitted(submission: { formTitle: string; name: string; phone: string; email: string; personaLabel: string; contactId: number | null; answers: { label: string; value: string }[]; id: string }): void {
    this.dispatch(`تسجيل جديد: ${submission.formTitle} — ${submission.name || '—'}`, [
      `وصل تسجيل جديد في نموذج «${submission.formTitle}» من ${APP_NAME}.`,
      '',
      ...personLines(submission.contactId !== null || submission.name || submission.phone || submission.email ? submission : null),
      submission.personaLabel ? `الفئة: ${submission.personaLabel}` : null,
      '',
      ...answerLines(submission.answers),
      `رقم التسجيل: ${submission.id}`,
      '',
      'القائمة الكاملة في لوحة الإدارة: قسم «نماذج التسجيل». بعد التواصل علّم التسجيل «تمت المعالجة».',
    ]);
  }

  serviceRequested(request: ServiceRequestLike): void {
    this.dispatch(`طلب خدمة من التطبيق: ${request.serviceTitle} — ${request.sender?.name || 'زائر'}`, [
      `طلب جديد لخدمة «${request.serviceTitle}» من ${APP_NAME}. فتح التطبيق واتساب (${request.channel}) برسالة الطلب الجاهزة.`,
      '',
      ...personLines(request.sender),
      ...answerLines(request.answers),
    ]);
  }

  /** «سجّل اهتمامك» on a golden company's in-app offer page (PROJECT_BRIEF §5.1): the CTA stays in-app. */
  goldenInterest(request: { companyName: string; code: string; sender: Person | null; name: string; phone: string; note: string }): void {
    this.dispatch(`تسجيل اهتمام بشراكة: ${request.companyName}`, [
      `سجّل ${request.sender ? 'عضو' : 'زائر'} اهتمامه بفرصة الشراكة في «${request.companyName}» من صفحة العرض داخل ${APP_NAME}.`,
      '',
      ...(request.sender ? personLines(request.sender) : [`الاسم: ${request.name || '—'}`, `الجوال: ${request.phone || '—'}`]),
      request.note.trim() ? `ملاحظة: ${request.note.trim()}` : null,
      `الشركة: ${request.companyName} (${request.code})`,
    ]);
  }

  paymentStarted(payment: PaymentLike): void {
    this.dispatch(`بدء دفع من التطبيق: ${payment.serviceTitle} — ${payment.name}`, [
      `بدأ العضو عملية دفع لخدمة «${payment.serviceTitle}» من ${APP_NAME}. لم يكتمل الدفع بعد.`,
      '',
      ...personLines(payment),
      `المبلغ: ${formatAmount(payment.amount, payment.currency)}${payment.memberPrice ? ' (سعر الأعضاء)' : ''}`,
      ...answerLines(payment.answers),
      `رقم العملية: ${payment.id}`,
      `بوابة الدفع: ${gatewayName(payment.provider)}`,
    ]);
  }

  paymentPaid(payment: PaymentLike): void {
    this.dispatch(`دفع ناجح من التطبيق: ${payment.serviceTitle} — ${payment.name}`, [
      `اكتمل دفع خدمة «${payment.serviceTitle}» من ${APP_NAME} (تأكيد من بوابة الدفع بعد التحقق من التوقيع).`,
      '',
      ...personLines(payment),
      `المبلغ: ${formatAmount(payment.amount, payment.currency)}${payment.memberPrice ? ' (سعر الأعضاء)' : ''}`,
      ...answerLines(payment.answers),
      `رقم العملية: ${payment.id}`,
      payment.transactionId ? `رقم عملية البوابة: ${payment.transactionId}` : null,
      `بوابة الدفع: ${gatewayName(payment.provider)}`,
      '',
      'يرجى التواصل مع العميل لبدء تنفيذ الخدمة.',
    ]);
  }

  /**
   * M110: the invoice mail (HTML) the moment a payment settles paid — to the customer, and the
   * exact same invoice to every registered admin address (owner, 2026-10-20: «ابعت للأدمن زيها
   * بالظبط لكل الأدمن المسجل»). Separate sends, so the customer never sees the admin list.
   * The awaited form reports each send's error text, for the dashboard resend and the mail probe.
   */
  async invoiceSend(input: { email: string; subject: string; text: string; html: string }): Promise<{ customer: string | null; admins: string | null }> {
    const subject = `${this.deps.appEnv === 'test' ? '[تجريبي] ' : ''}${input.subject}`;
    const sendTo = async (to: string[], mailSubject: string): Promise<string | null> => {
      try {
        const sent = await this.deps.mailer.send({ to, subject: mailSubject, text: input.text, html: input.html });
        this.deps.log.info({ subject: mailSubject, sent }, 'invoice mail');
        return sent ? null : 'smtp_not_configured';
      } catch (error) {
        this.deps.log.error({ err: error, subject: mailSubject }, 'invoice mail failed');
        return String(error).slice(0, 300);
      }
    };
    return {
      customer: input.email.trim() ? await sendTo([input.email.trim()], subject) : 'no_customer_email',
      admins: this.recipients.length ? await sendTo(this.recipients, `${SUBJECT_PREFIX} نسخة الإدارة — ${input.subject}`) : 'no_recipients',
    };
  }

  /** A minimal awaited send that surfaces the SMTP error text (the dashboard's mail probe). */
  async probe(): Promise<{ sent: boolean; error: string | null; recipients: number }> {
    if (!this.recipients.length) return { sent: false, error: 'no_recipients', recipients: 0 };
    try {
      const sent = await this.deps.mailer.send({
        to: this.recipients,
        subject: `${SUBJECT_PREFIX} فحص البريد — ${riyadhDateTime(Date.now())}`,
        text: `رسالة فحص من ${APP_NAME}: لو وصلتك، فإرسال البريد من السيرفر يعمل.`,
      });
      return { sent, error: sent ? null : 'smtp_not_configured', recipients: this.recipients.length };
    } catch (error) {
      return { sent: false, error: String(error).slice(0, 300), recipients: this.recipients.length };
    }
  }

  paymentFailed(payment: PaymentLike): void {
    this.dispatch(`دفع غير مكتمل من التطبيق: ${payment.serviceTitle} — ${payment.name}`, [
      `لم يكتمل دفع خدمة «${payment.serviceTitle}» من ${APP_NAME}.`,
      '',
      ...personLines(payment),
      `المبلغ: ${formatAmount(payment.amount, payment.currency)}`,
      payment.failureReason ? `سبب البوابة: ${payment.failureReason}` : null,
      `رقم العملية: ${payment.id}`,
    ]);
  }

  membershipActivated(activation: ActivationLike): void {
    const sandbox = activation.environment === 'SANDBOX';
    const rows = [
      { label: 'الاسم', value: activation.name || '—' },
      { label: 'الجوال', value: activation.phone || '—' },
      { label: 'البريد', value: activation.email || '—' },
      ...(activation.contactEmail ? [{ label: 'بريد التواصل', value: activation.contactEmail }] : []),
      ...(activation.cardNumber ? [{ label: 'رقم العضوية', value: activation.cardNumber }] : []),
      { label: 'المنتج', value: activation.productId },
      { label: 'المتجر', value: `${storeLabel(activation.store, 'ar')}${sandbox ? ' (بيئة اختبار)' : ''}` },
      { label: 'المدة', value: `${activation.days} يومًا${activation.expiresAt ? ` · تنتهي في ${riyadhDateTime(activation.expiresAt)}` : ''}` },
      { label: 'مرجع العملية', value: activation.reference },
    ];
    // M156 (owner): the admins' copy wears the same royal shell as the member's.
    const html = royalHtml({
      lang: 'ar',
      title: 'تفعيل عضوية سنوية من المتجر',
      subtitle: activation.name,
      lead: [`اشترى العضو العضوية السنوية لنادي المستثمرين من داخل ${APP_NAME} عبر المتجر، وفُعّلت عضويته في الهب فورًا.`],
      rows,
      note: `${riyadhDateTime(Date.now())} (الرياض) · ${APP_NAME}`,
      ...(this.deps.publicUrl ? { sealUrl: `${this.deps.publicUrl}/pay/invoice-stamp.png` } : {}),
    });
    this.dispatch(
      `تفعيل عضوية سنوية من المتجر: ${activation.name}`,
      [
        `اشترى العضو العضوية السنوية لنادي المستثمرين من داخل ${APP_NAME} عبر متجر التطبيقات، وفُعّلت عضويته في الهب.`,
        '',
        ...personLines(activation),
        activation.contactEmail ? `بريد التواصل: ${activation.contactEmail}` : null,
        `المنتج: ${activation.productId}`,
        `المتجر: ${activation.store}${sandbox ? ' (بيئة اختبار)' : ''}`,
        `المدة: ${activation.days} يومًا${activation.expiresAt ? ` · تنتهي في ${riyadhDateTime(activation.expiresAt)}` : ''}`,
        `مرجع العملية: ${activation.reference}`,
      ],
      html,
    );
  }

  /**
   * M156 (owner, 2026-10-29: «أي حد يشتري عضوية لازم فورًا يوصله إيميل… ملكي… قصير… على إيميله الحقيقي»): the
   * member's own confirmation, sent the moment the hub activates the membership — to the real address he gave
   * us over an Apple relay, else to the account's e-mail (a relay forwards it to his inbox anyway).
   */
  memberActivated(activation: ActivationLike): void {
    const lang = activation.lang === 'en' ? 'en' : 'ar';
    const to = (activation.contactEmail ?? '').trim() || activation.email;
    const name = activation.name.trim();
    const store = storeLabel(activation.store, lang);
    const until = activation.expiresAt ? (lang === 'en' ? riyadhDateTimeEn(activation.expiresAt) : riyadhDateTime(activation.expiresAt)).split(' ')[0] : '';
    const appUrl = `${this.deps.publicUrl ?? 'https://vcmem.com'}/app`;
    const mail: RoyalMail =
      lang === 'en'
        ? {
            lang,
            title: 'Your membership is active',
            subtitle: 'Investors Club · annual membership',
            greeting: name ? `Welcome, ${name}.` : 'Welcome.',
            lead: ['Your annual Investors Club membership is now active. Every partnership, service and privilege of the club is open to you inside the app.'],
            rows: [
              ...(activation.cardNumber ? [{ label: 'Membership no.', value: activation.cardNumber }] : []),
              ...(until ? [{ label: 'Valid until', value: until }] : []),
              { label: 'Purchased via', value: store },
              { label: 'Reference', value: activation.reference },
            ],
            cta: { label: 'Open your membership card', url: appUrl },
            note: `This is your activation confirmation. The purchase receipt is issued by ${store} to your store account.`,
          }
        : {
            lang,
            title: 'عضويتك مفعّلة',
            subtitle: 'Investors Club · العضوية السنوية',
            greeting: name ? `أهلًا بك يا ${name}.` : 'أهلًا بك.',
            lead: ['فُعّلت عضويتك السنوية في نادي المستثمرين. كل الشراكات والخدمات والمزايا متاحة لك الآن من داخل التطبيق.'],
            rows: [
              ...(activation.cardNumber ? [{ label: 'رقم العضوية', value: activation.cardNumber }] : []),
              ...(until ? [{ label: 'سارية حتى', value: until }] : []),
              { label: 'تم الشراء عبر', value: store },
              { label: 'مرجع العملية', value: activation.reference },
            ],
            cta: { label: 'افتح بطاقة عضويتك', url: appUrl },
            note: `هذه الرسالة تأكيد تفعيل العضوية. إيصال الشراء يصلك من ${store} على حساب متجرك.`,
          };
    this.sendRoyal(to, lang === 'en' ? 'Your Investors Club membership is active' : 'عضويتك في Investors Club مفعّلة', mail, 'membership activation');
  }

  membershipActivationPending(activation: ActivationLike, reason: string): void {
    this.dispatch(`عضوية من المتجر تحتاج تفعيلًا يدويًا: ${activation.name}`, [
      `اشترى العضو العضوية السنوية من داخل ${APP_NAME}، لكن لم يمكن تفعيلها تلقائيًا في الهب (${reason}). يرجى تفعيلها يدويًا من لوحة الهب.`,
      '',
      ...personLines(activation),
      `رقم الحساب في الهب: ${activation.contactId}`,
      `المنتج: ${activation.productId}`,
      `المتجر: ${activation.store}${activation.environment === 'SANDBOX' ? ' (بيئة اختبار)' : ''}`,
      `المدة: ${activation.days} يومًا`,
      `مرجع العملية: ${activation.reference}`,
    ]);
  }
}
