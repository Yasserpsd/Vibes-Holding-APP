import type { FastifyBaseLogger } from 'fastify';

import type { Mailer } from './mailer.js';

/**
 * Management notifications: one plain-text Arabic e-mail per action, in the style of the website's
 * own notifications (subject prefix [Vibes AI], Riyadh time), sent to the NOTIFY_EMAIL list.
 * Sending never blocks or fails a request: mails go out in the background and errors are logged.
 */
const SUBJECT_PREFIX = '[Vibes AI]';
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
};

export type NotifierDeps = { mailer: Mailer; recipients: string[]; log: FastifyBaseLogger; appEnv: 'test' | 'production' };

function personLines(person: Person | null): string[] {
  if (!person) return ['المرسل: زائر بدون حساب'];
  return [`الاسم: ${person.name || '—'}`, `الجوال: ${person.phone || '—'}`, `البريد: ${person.email || '—'}`];
}

function answerLines(answers: Answer[]): string[] {
  return answers.filter((answer) => answer.value.trim()).map((answer) => `${answer.label}: ${answer.value.trim()}`);
}

function gatewayName(provider: string): string {
  return provider === 'mock' ? 'تجريبية (بدون بوابة حقيقية)' : 'Paymob';
}

export class Notifier {
  constructor(private readonly deps: NotifierDeps) {}

  get configured(): boolean {
    return this.deps.mailer.configured && this.deps.recipients.length > 0;
  }

  status(): { configured: boolean; recipients: number } {
    return { configured: this.configured, recipients: this.deps.recipients.length };
  }

  private dispatch(subject: string, lines: (string | null)[]): void {
    const fullSubject = `${SUBJECT_PREFIX}${this.deps.appEnv === 'test' ? ' [تجريبي]' : ''} ${subject}`;
    const body = lines.filter((line): line is string => line !== null);
    const text = [...body, '', `التاريخ: ${riyadhDateTime(Date.now())} (الرياض)`, `المصدر: ${APP_NAME}`].join('\n');
    if (!this.deps.recipients.length) {
      this.deps.log.info({ subject: fullSubject }, 'notification skipped: NOTIFY_EMAIL is not set');
      return;
    }
    this.deps.mailer
      .send({ to: this.deps.recipients, subject: fullSubject, text })
      .then((sent) => this.deps.log.info({ subject: fullSubject, sent }, 'notification'))
      .catch((error: unknown) => this.deps.log.error({ err: error, subject: fullSubject }, 'notification mail failed'));
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

  /** M30: a member asked for his membership card printed and delivered (his own choice, no charge). */
  cardPrintRequested(request: { id: string; name: string; phone: string; email: string; cardNumber: string; personaLabel: string; city: string; address: string; note: string }): void {
    this.dispatch(`طلب طباعة كارت العضوية: ${request.name}`, [
      `طلب العضو نسخة مطبوعة من كارت عضويته تُوصَّل إلى عنوانه بدون رسوم (من ${APP_NAME}).`,
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

  serviceRequested(request: ServiceRequestLike): void {
    this.dispatch(`طلب خدمة من التطبيق: ${request.serviceTitle} — ${request.sender?.name || 'زائر'}`, [
      `طلب جديد لخدمة «${request.serviceTitle}» من ${APP_NAME}. فتح التطبيق واتساب (${request.channel}) برسالة الطلب الجاهزة.`,
      '',
      ...personLines(request.sender),
      ...answerLines(request.answers),
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
    this.dispatch(`تفعيل عضوية سنوية من المتجر: ${activation.name}`, [
      `اشترى العضو العضوية السنوية لنادي المستثمرين من داخل ${APP_NAME} عبر متجر التطبيقات، وفُعّلت عضويته في الهب.`,
      '',
      ...personLines(activation),
      `المنتج: ${activation.productId}`,
      `المتجر: ${activation.store}${activation.environment === 'SANDBOX' ? ' (بيئة اختبار)' : ''}`,
      `المدة: ${activation.days} يومًا${activation.expiresAt ? ` · تنتهي في ${riyadhDateTime(activation.expiresAt)}` : ''}`,
      `مرجع العملية: ${activation.reference}`,
    ]);
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
