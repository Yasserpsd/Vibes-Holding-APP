import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import { priceFor, toPublicService, type ServicesContent } from '../content/services.js';
import type { AppliedDiscount, DiscountsService } from '../discounts/service.js';
import type { HubPayment } from '../hub/types.js';
import type { Notifier, PaymentLike } from '../mail/notify.js';
import type { PushService } from '../push/service.js';
import { lastRiyadhDays, riyadhDay } from '../riyadh.js';
import type { KV } from '../store.js';
import { redirectDigest, toRedirectQuery, verifyRedirect, verifyWebhook, webhookDigest, type Json } from './hmac.js';
import type { AppLang } from '../lang.js';
import { invoiceHtml, invoiceSubject, invoiceText } from './invoice.js';
import type { MoyasarConfirmer } from './moyasar.js';
import type { PaymobGateway } from './paymob.js';

/** M132a: what a hub (site) payment `action` is called on the invoice; anything else keeps the hub's own note. */
const SITE_ACTION_TITLES: Record<string, string> = {
  membership: 'العضوية السنوية لنادي المستثمرين',
  workshop: 'ورشة عمل',
  event: 'تسجيل فعالية',
  pitchdeck: 'Pitch Deck',
  urmeet: 'اصنع ملتقاك',
};

/**
 * In-app payments for real-world services (CLAUDE.md rule 3): the server creates the Paymob intention,
 * the app opens the checkout, and only Paymob's HMAC-verified callback marks a payment paid (rule 5).
 * Payments live in one kv document (single-instance server, writes serialized in process).
 */
export const PAYMENTS_KEY = 'payments:orders';
/** M110: the growing invoice number the customer sees (never the payment uuid). */
const INVOICE_SEQ_KEY = 'payments:invoiceSeq';
const FIRST_INVOICE_NO = 10001;
const KEEP_DAYS = 400;

export type PaymentStatus = 'created' | 'paid' | 'failed';
type Answer = { key: string; label: string; value: string };

export type Payment = {
  id: string;
  contactId: number;
  name: string;
  email: string;
  phone: string;
  serviceKey: string;
  serviceTitle: string;
  answers: Answer[];
  amount: number;
  amountCents: number;
  currency: string;
  memberPrice: boolean;
  status: PaymentStatus;
  /** M107: `code` = confirmed by a 100% discount code, no gateway involved. */
  provider: 'paymob' | 'moyasar' | 'mock' | 'code' | 'hub';
  /** M107: the discount code applied to this payment, if any (the use is recorded once it settles paid). */
  discountCode?: string | null;
  discountPercent?: number | null;
  /** The amount before the discount (the list or member price). */
  preDiscountSar?: number | null;
  intentionId: string;
  orderId: string;
  clientSecret: string;
  checkoutUrl: string;
  transactionId: string | null;
  failureReason: string | null;
  /** M110: assigned the moment the payment settles paid; names the customer's invoice. */
  invoiceNo?: number | null;
  /** M113: the customer's app language at purchase — the invoice renders entirely in it. */
  lang?: AppLang | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  failedAt: string | null;
};

export type PublicPayment = Pick<
  Payment,
  | 'id'
  | 'serviceKey'
  | 'serviceTitle'
  | 'answers'
  | 'amount'
  | 'currency'
  | 'memberPrice'
  | 'status'
  | 'provider'
  | 'discountCode'
  | 'discountPercent'
  | 'preDiscountSar'
  | 'checkoutUrl'
  | 'transactionId'
  | 'failureReason'
  | 'invoiceNo'
  | 'createdAt'
  | 'paidAt'
  | 'failedAt'
>;

export type AdminPayment = PublicPayment & Pick<Payment, 'contactId' | 'name' | 'email' | 'phone' | 'orderId' | 'intentionId'>;

/** Dashboard home: payments per Riyadh day. `count` = created that day, `paid` and `cents` = paid that day. */
export type PaymentTotals = { count: number; cents: number; paid: number };
export type PaymentStats = { series: ({ day: string } & PaymentTotals)[]; today: PaymentTotals; month: PaymentTotals };

export type RedirectResult = { payment: PublicPayment | null; verified: boolean; gatewaySuccess: boolean | null };

type Deps = { kv: KV; log: FastifyBaseLogger; gateway: PaymobGateway & Partial<MoyasarConfirmer>; notifier: Notifier; push: PushService; hmacSecret: string; publicUrl: string; discounts?: DiscountsService };

function isoDaysAgo(now: number, days: number): string {
  return new Date(now - days * 86_400_000).toISOString();
}

export class PaymentsService {
  private chain: Promise<unknown> = Promise.resolve();
  private known = 0;
  /** M41: modules that own a payment (the agenda) hear its final webhook state here. */
  private readonly settledListeners: ((payment: Payment) => void)[] = [];

  constructor(private readonly deps: Deps) {}

  onSettled(listener: (payment: Payment) => void): void {
    this.settledListeners.push(listener);
  }

  get mode(): 'live' | 'mock' {
    return this.deps.gateway.mode;
  }

  status(): { mode: 'live' | 'mock'; known: number } {
    return { mode: this.mode, known: this.known };
  }

  private async load(): Promise<Payment[]> {
    const stored = await this.deps.kv.get<{ payments: Payment[] }>(PAYMENTS_KEY);
    return stored?.payments ?? [];
  }

  /** Read-modify-write under an in-process lock; old payments are pruned on every write. */
  private mutate<T>(fn: (payments: Payment[]) => T | Promise<T>, now = Date.now()): Promise<T> {
    const run = this.chain.then(async () => {
      const payments = await this.load();
      const result = await fn(payments);
      const kept = payments.filter((payment) => payment.createdAt >= isoDaysAgo(now, KEEP_DAYS));
      await this.deps.kv.set(PAYMENTS_KEY, { payments: kept });
      this.known = kept.length;
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private toPublic(payment: Payment): PublicPayment {
    return {
      id: payment.id,
      serviceKey: payment.serviceKey,
      serviceTitle: payment.serviceTitle,
      answers: payment.answers,
      amount: payment.amount,
      currency: payment.currency,
      memberPrice: payment.memberPrice,
      status: payment.status,
      provider: payment.provider,
      discountCode: payment.discountCode ?? null,
      discountPercent: payment.discountPercent ?? null,
      preDiscountSar: payment.preDiscountSar ?? null,
      checkoutUrl: payment.checkoutUrl,
      transactionId: payment.transactionId,
      failureReason: payment.failureReason,
      invoiceNo: payment.invoiceNo ?? null,
      createdAt: payment.createdAt,
      paidAt: payment.paidAt,
      failedAt: payment.failedAt,
    };
  }

  private toAdmin(payment: Payment): AdminPayment {
    return {
      ...this.toPublic(payment),
      contactId: payment.contactId,
      name: payment.name,
      email: payment.email,
      phone: payment.phone,
      orderId: payment.orderId,
      intentionId: payment.intentionId,
    };
  }

  private toMail(payment: Payment): PaymentLike {
    return {
      id: payment.id,
      name: payment.name,
      phone: payment.phone,
      email: payment.email,
      serviceTitle: payment.serviceTitle,
      amount: payment.amount,
      currency: payment.currency,
      memberPrice: payment.memberPrice,
      answers: payment.answers,
      provider: payment.provider,
      createdAt: payment.createdAt,
      transactionId: payment.transactionId,
      failureReason: payment.failureReason,
    };
  }

  /** M107: the «كود الخصم» answer row, so the retry screen and the management mail name the code. */
  private static discountAnswer(discount: AppliedDiscount): Answer {
    return { key: 'discount', label: 'كود الخصم', value: `${discount.code} (خصم ${discount.percent}%)` };
  }

  /**
   * M107: a 100% code confirms the order with no gateway at all (rule 5 untouched: no gateway said
   * anything, there is simply nothing to pay). The use is recorded at once and the settled listeners
   * fire, so an agenda registration confirms through the same path as a paid one.
   */
  private async createFreePayment(
    customer: { contactId: number; name: string; email: string; phone: string },
    input: { key: string; title: string; answers: Answer[]; currency: string; memberPrice: boolean; discount: AppliedDiscount; lang?: AppLang },
    now: number,
  ): Promise<Payment> {
    const id = randomUUID();
    const stamp = new Date(now).toISOString();
    const payment: Payment = {
      id,
      contactId: customer.contactId,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      serviceKey: input.key,
      serviceTitle: input.title,
      answers: [...input.answers, PaymentsService.discountAnswer(input.discount)],
      amount: 0,
      amountCents: 0,
      currency: input.currency,
      memberPrice: input.memberPrice,
      status: 'paid',
      provider: 'code',
      discountCode: input.discount.code,
      discountPercent: input.discount.percent,
      preDiscountSar: input.discount.amountBefore,
      intentionId: '',
      orderId: '',
      clientSecret: '',
      checkoutUrl: '',
      transactionId: null,
      failureReason: null,
      lang: input.lang ?? 'ar',
      createdAt: stamp,
      updatedAt: stamp,
      paidAt: stamp,
      failedAt: null,
    };
    await this.mutate((payments) => {
      payments.push(payment);
    }, now);
    this.deps.log.info({ payment: id, service: input.key, code: input.discount.code }, 'order confirmed by a 100% discount code');
    // M110: the shared settle tail — discount use, mails (invoice included), push and listeners.
    await this.announceSettled(payment, now);
    return payment;
  }

  /** One confirmed use per settled payment (the service dedupes by payment id). */
  private async recordDiscountUse(payment: Payment, now: number): Promise<void> {
    if (!this.deps.discounts || !payment.discountCode) return;
    try {
      await this.deps.discounts.recordUse(
        {
          code: payment.discountCode,
          contactId: payment.contactId,
          name: payment.name,
          context: payment.serviceKey,
          label: payment.serviceTitle,
          amountBefore: payment.preDiscountSar ?? payment.amount,
          amountAfter: payment.amount,
          paymentId: payment.id,
        },
        now,
      );
    } catch (error) {
      this.deps.log.error({ err: error, payment: payment.id }, 'discount use not recorded');
    }
  }

  /** Shared core: creates the gateway intention and records the payment as created (rule 5: only the webhook pays it). */
  private async createPayment(
    customer: { contactId: number; name: string; email: string; phone: string },
    input: { key: string; title: string; answers: Answer[]; amount: number; currency: string; memberPrice: boolean; discount?: AppliedDiscount; validHours?: number; lang?: AppLang },
    now: number,
  ): Promise<Payment> {
    const id = randomUUID();
    const [firstName = '', ...rest] = customer.name.trim().split(/\s+/);
    const provider = this.deps.gateway.provider;
    const intention = await this.deps.gateway.createIntention({
      paymentId: id,
      amountCents: input.amount * 100,
      currency: input.currency,
      itemName: input.title,
      description: `${input.title} — تطبيق نادي المستثمرين`,
      customer: { firstName, lastName: rest.join(' '), email: customer.email || 'no-reply@vcmem.com', phone: customer.phone || '0500000000' },
      notificationUrl:
        provider === 'moyasar' ? `${this.deps.publicUrl}/api/payments/moyasar/callback?payment=${id}` : `${this.deps.publicUrl}/api/payments/paymob/webhook`,
      redirectionUrl: `${this.deps.publicUrl}/pay/return?payment=${id}`,
      extras: { app: 'investorsclub', payment: id, service: input.key, contact: String(customer.contactId) },
      ...(input.validHours ? { validHours: input.validHours } : {}),
    });
    const stamp = new Date(now).toISOString();
    const payment: Payment = {
      id,
      contactId: customer.contactId,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      serviceKey: input.key,
      serviceTitle: input.title,
      answers: input.discount ? [...input.answers, PaymentsService.discountAnswer(input.discount)] : input.answers,
      amount: input.amount,
      amountCents: input.amount * 100,
      currency: input.currency,
      memberPrice: input.memberPrice,
      status: 'created',
      provider: this.deps.gateway.provider,
      discountCode: input.discount?.code ?? null,
      discountPercent: input.discount?.percent ?? null,
      preDiscountSar: input.discount?.amountBefore ?? null,
      intentionId: intention.intentionId,
      orderId: intention.orderId,
      clientSecret: intention.clientSecret,
      checkoutUrl: intention.checkoutUrl,
      transactionId: null,
      failureReason: null,
      lang: input.lang ?? 'ar',
      createdAt: stamp,
      updatedAt: stamp,
      paidAt: null,
      failedAt: null,
    };
    await this.mutate((payments) => {
      payments.push(payment);
    }, now);
    this.deps.log.info({ payment: id, service: input.key, amount: input.amount, mode: this.mode }, 'payment started');
    this.deps.notifier.paymentStarted(this.toMail(payment));
    return payment;
  }

  /** Creates the gateway intention for a paid service and records the payment as created. */
  async start(me: Me, serviceKey: string, rawAnswers: Record<string, string>, content: ServicesContent, discountCode?: string, lang: AppLang = 'ar', now = Date.now()): Promise<PublicPayment> {
    const service = content.services.find((entry) => entry.key === serviceKey);
    if (!service) throw new RequestError('not_found', 'الخدمة غير موجودة', 404);
    if (toPublicService(service, me).locked || service.action.type !== 'paymob') {
      throw new RequestError('not_payable', 'هذه الخدمة لا تُدفع من داخل التطبيق', 403);
    }
    const price = priceFor(service, me);
    if (!price) throw new RequestError('not_payable', 'هذه الخدمة لا تُدفع من داخل التطبيق', 403);
    // Every field of a paid service is required: the management mail and the retry screen depend on the answers.
    const missing = service.action.fields.find((field) => !(rawAnswers[field.key] ?? '').trim());
    if (missing) throw new RequestError('invalid', `أكمل تفاصيل الطلب قبل الدفع: ${missing.label}`, 400);
    const answers = service.action.fields.map((field) => ({ key: field.key, label: field.label, value: (rawAnswers[field.key] ?? '').trim().slice(0, 300) }));
    const customer = { contactId: me.id, name: me.name, email: me.contactEmail || me.email, phone: me.phone };
    // M107: a discount code shrinks the amount; a 100% code confirms with no gateway.
    const discount = discountCode && this.deps.discounts ? await this.deps.discounts.apply(discountCode, price.amount, now) : undefined;
    const base = { key: service.key, title: service.title, answers, currency: price.currency, memberPrice: price.memberPrice, lang };
    const payment =
      discount && discount.amountAfter === 0
        ? await this.createFreePayment(customer, { ...base, discount }, now)
        : await this.createPayment(customer, { ...base, amount: discount ? discount.amountAfter : price.amount, discount }, now);
    return this.toPublic(payment);
  }

  /** M41 «أجندة النادي»: the attendance fee (M107: members pay their member price too; a 100% code confirms without the gateway). */
  async startAgenda(
    me: Me,
    input: { eventId: string; eventTitle: string; attendanceLabel: string; amountSar: number; memberPrice?: boolean; discount?: AppliedDiscount; lang?: AppLang },
    now = Date.now(),
  ): Promise<PublicPayment> {
    const customer = { contactId: me.id, name: me.name, email: me.contactEmail || me.email, phone: me.phone };
    const base = {
      key: `agenda:${input.eventId}`,
      title: `حضور فعالية: ${input.eventTitle}`,
      answers: [{ key: 'attendance', label: 'طريقة الحضور', value: input.attendanceLabel }],
      currency: 'SAR',
      memberPrice: input.memberPrice ?? false,
      lang: input.lang,
    };
    const payment =
      input.discount && input.discount.amountAfter === 0
        ? await this.createFreePayment(customer, { ...base, discount: input.discount }, now)
        : await this.createPayment(customer, { ...base, amount: input.discount ? input.discount.amountAfter : input.amountSar, discount: input.discount }, now);
    return this.toPublic(payment);
  }

  /**
   * M44 «روابط الدفع»: the owner sells by a link he creates in the dashboard (a real-world sale outside
   * the app — never shown inside it, rule 3 intact). The customer may hold no app account at all.
   */
  async startLink(
    input: { kind: string; label: string; amountSar: number; customer: { contactId: number; name: string; email: string; phone: string }; ref?: string; validHours?: number },
    now = Date.now(),
  ): Promise<Payment> {
    return this.createPayment(
      input.customer,
      // A link is sent and paid at the customer's pace: the checkout stays payable for 30 days.
      // `ref` ties a payment spawned by a PERMANENT link back to its link row (M108b).
      {
        key: input.ref ? `link:${input.kind}:${input.ref}` : `link:${input.kind}`,
        title: input.label,
        answers: [],
        amount: input.amountSar,
        currency: 'SAR',
        memberPrice: false,
        validHours: input.validHours ?? 30 * 24,
      },
      now,
    );
  }

  /** M44: one payment by id for the dashboard's links list. */
  async byId(id: string): Promise<Payment | null> {
    return (await this.load()).find((entry) => entry.id === id) ?? null;
  }

  /** Paymob's transaction-processed callback: the only path that marks a payment paid or failed. */
  async handleWebhook(payload: unknown, hmac: string | undefined, now = Date.now()): Promise<{ ok: true; id: string | null; status: PaymentStatus | null }> {
    const body = (payload ?? {}) as { type?: unknown; obj?: unknown };
    if (body.type !== 'TRANSACTION' || !body.obj || typeof body.obj !== 'object') {
      this.deps.log.info({ type: body.type }, 'paymob callback ignored (not a transaction)');
      return { ok: true, id: null, status: null };
    }
    const obj = body.obj as Json;
    if (!verifyWebhook(obj, hmac, this.deps.hmacSecret)) throw new RequestError('invalid_hmac', 'توقيع غير صحيح', 401);
    const order = (obj.order ?? {}) as Json;
    const orderId = order.id === undefined || order.id === null ? '' : String(order.id);
    const reference = order.merchant_order_id === undefined || order.merchant_order_id === null ? '' : String(order.merchant_order_id);
    const success = obj.success === true && obj.pending !== true && obj.is_voided !== true && obj.is_refunded !== true;
    const amountCents = Number(obj.amount_cents);
    const data = (obj.data ?? {}) as Json;
    const reason = typeof data.message === 'string' ? data.message.slice(0, 200) : null;

    const result = await this.mutate((payments) => {
      const payment = payments.find((entry) => (orderId !== '' && entry.orderId === orderId) || (reference !== '' && entry.id === reference));
      if (!payment) return null;
      if (payment.status === 'paid') return { payment, changed: false };
      const stamp = new Date(now).toISOString();
      payment.transactionId = obj.id === undefined || obj.id === null ? null : String(obj.id);
      payment.updatedAt = stamp;
      if (success && amountCents === payment.amountCents) {
        payment.status = 'paid';
        payment.paidAt = stamp;
        payment.failureReason = null;
      } else {
        payment.status = 'failed';
        payment.failedAt = stamp;
        payment.failureReason = success ? `amount mismatch (${amountCents})` : (reason ?? 'declined');
      }
      return { payment, changed: true };
    }, now);

    if (!result) {
      this.deps.log.warn({ orderId, reference }, 'paymob callback for an unknown order');
      return { ok: true, id: null, status: null };
    }
    if (result.changed) await this.announceSettled(result.payment, now);
    return { ok: true, id: result.payment.id, status: result.payment.status };
  }

  /** M110: one growing number per paid payment, assigned exactly once under the write lock. */
  private async assignInvoiceNo(paymentId: string, now: number): Promise<number | null> {
    return this.mutate(async (payments) => {
      const payment = payments.find((entry) => entry.id === paymentId);
      if (!payment) return null;
      if (payment.invoiceNo) return payment.invoiceNo;
      const stored = await this.deps.kv.get<{ next: number }>(INVOICE_SEQ_KEY);
      const next = stored?.next ?? FIRST_INVOICE_NO;
      await this.deps.kv.set(INVOICE_SEQ_KEY, { next: next + 1 });
      payment.invoiceNo = next;
      return next;
    }, now);
  }

  /** M110: the dashboard resend — re-mails the invoice and reports each send's exact error. */
  async resendInvoice(id: string, now = Date.now()): Promise<{ ok: boolean; invoiceNo: number; customer: string | null; admins: string | null }> {
    const payment = (await this.load()).find((entry) => entry.id === id);
    if (!payment || payment.status !== 'paid') throw new RequestError('not_found', 'لا توجد عملية مدفوعة بهذا الرقم', 404);
    const invoiceNo = payment.invoiceNo ?? (await this.assignInvoiceNo(payment.id, now));
    if (!invoiceNo) throw new RequestError('not_found', 'العملية غير موجودة', 404);
    payment.invoiceNo = invoiceNo;
    const lang = payment.lang ?? 'ar';
    const result = await this.deps.notifier.invoiceSend({
      email: payment.email,
      subject: invoiceSubject(invoiceNo, lang),
      text: invoiceText(payment, invoiceNo, `${this.deps.publicUrl}/pay/invoice/${payment.id}`, lang),
      html: invoiceHtml(payment, invoiceNo, lang, this.deps.publicUrl),
    });
    return { ok: result.customer === null && result.admins === null, invoiceNo, customer: result.customer, admins: result.admins };
  }

  /** Sends a minimal admin mail and surfaces the SMTP error text (why nothing arrives). */
  mailProbe(): Promise<{ sent: boolean; error: string | null; recipients: number }> {
    return this.deps.notifier.probe();
  }

  /**
   * M132a (owner: «لو حد دفع من السايت نفس الفاتورة زي ابليكشن»): a payment the hub recorded on the SITE (Paymob on
   * vcmem) becomes a paid payment here too, so the customer gets the SAME numbered invoice the app issues (mail +
   * /pay/invoice/:id). Idempotent on the hub payment id; the hub's own receipt and admin mails are not repeated here.
   */
  async recordSitePayment(hubPayment: HubPayment & { lang?: string }, now = Date.now()): Promise<Payment | null> {
    if (!hubPayment.success) return null;
    const orderId = `hub:${hubPayment.id}`;
    const existing = (await this.load()).find((entry) => entry.provider === 'hub' && entry.orderId === orderId);
    if (existing) return existing;
    const action = hubPayment.action || 'service';
    const title = SITE_ACTION_TITLES[action] ?? (hubPayment.note || action);
    const amountCents = Math.max(0, Math.round(hubPayment.amount_cents));
    const paidAt = hubPayment.created_at ? new Date(`${hubPayment.created_at.replace(' ', 'T')}Z`) : new Date(now);
    const stamp = Number.isNaN(paidAt.getTime()) ? new Date(now).toISOString() : paidAt.toISOString();
    const lang: AppLang = hubPayment.lang === 'en' ? 'en' : 'ar';
    const payment: Payment = {
      id: randomUUID(),
      contactId: hubPayment.contact_id || 0,
      name: hubPayment.name || '',
      email: hubPayment.email || '',
      phone: hubPayment.phone || '',
      serviceKey: `site:${action}`,
      serviceTitle: title,
      answers: hubPayment.note ? [{ key: 'note', label: lang === 'en' ? 'Site payment' : 'دفعة من الموقع', value: hubPayment.note }] : [],
      amount: amountCents / 100,
      amountCents,
      currency: (hubPayment.currency || 'SAR').toUpperCase(),
      memberPrice: false,
      status: 'paid',
      provider: 'hub',
      discountCode: null,
      discountPercent: null,
      preDiscountSar: null,
      intentionId: `hub:${hubPayment.txn_id || hubPayment.id}`,
      orderId,
      clientSecret: '',
      checkoutUrl: '',
      transactionId: hubPayment.txn_id || null,
      failureReason: null,
      lang,
      createdAt: stamp,
      updatedAt: new Date(now).toISOString(),
      paidAt: stamp,
      failedAt: null,
    };
    await this.mutate((payments) => {
      payments.push(payment);
    }, now);
    const invoiceNo = await this.assignInvoiceNo(payment.id, now);
    if (invoiceNo) {
      payment.invoiceNo = invoiceNo;
      if (payment.email) {
        await this.deps.notifier.invoiceSend({
          email: payment.email,
          subject: invoiceSubject(invoiceNo, lang),
          text: invoiceText(payment, invoiceNo, `${this.deps.publicUrl}/pay/invoice/${payment.id}`, lang),
          html: invoiceHtml(payment, invoiceNo, lang, this.deps.publicUrl),
        });
      }
    }
    this.deps.log.info({ payment: payment.id, hub: hubPayment.id, action, invoiceNo: payment.invoiceNo ?? null }, 'site payment recorded with the app invoice');
    return payment;
  }

  /** M110: the printable invoice page (/pay/invoice/:id) — paid payments only, in the buyer's language. */
  async invoicePage(id: string): Promise<string | null> {
    const payment = (await this.load()).find((entry) => entry.id === id);
    if (!payment || payment.status !== 'paid' || !payment.invoiceNo) return null;
    return invoiceHtml(payment, payment.invoiceNo, payment.lang ?? 'ar', this.deps.publicUrl);
  }

  /** Everything that happens once a gateway settled a payment: code use, mails, push, module listeners. */
  private async announceSettled(payment: Payment, now: number): Promise<void> {
    this.deps.log.info({ payment: payment.id, status: payment.status }, 'payment updated from the gateway callback');
    // M110: the customer's instant invoice — numbered once, mailed as HTML, kept at /pay/invoice/:id.
    if (payment.status === 'paid') {
      const invoiceNo = await this.assignInvoiceNo(payment.id, now);
      if (invoiceNo) {
        payment.invoiceNo = invoiceNo;
        const lang = payment.lang ?? 'ar';
        await this.deps.notifier.invoiceSend({
          email: payment.email,
          subject: invoiceSubject(invoiceNo, lang),
          text: invoiceText(payment, invoiceNo, `${this.deps.publicUrl}/pay/invoice/${payment.id}`, lang),
          html: invoiceHtml(payment, invoiceNo, lang, this.deps.publicUrl),
        });
      }
    }
    // M44: a payment-link sale gets its own richer mail from the links listener instead of the generic one.
    const linkSale = payment.serviceKey.startsWith('link:');
    // M107: a code on a paid order counts as used only now, when the gateway confirmed the money.
    if (payment.status === 'paid') await this.recordDiscountUse(payment, now);
    if (payment.status === 'paid' && !linkSale) this.deps.notifier.paymentPaid(this.toMail(payment));
    else if (payment.status !== 'paid' && !linkSale) this.deps.notifier.paymentFailed(this.toMail(payment));
    if (payment.status === 'paid' || payment.status === 'failed') {
      const { id, contactId, serviceTitle, amount, currency, status } = payment;
      this.deps.push.paymentResult({ id, contactId, serviceTitle, amount, currency, status });
      for (const listener of this.settledListeners) {
        try {
          listener(payment);
        } catch (error) {
          this.deps.log.error({ err: error, payment: id }, 'payment settled listener failed');
        }
      }
    }
  }

  /**
   * Moyasar settles here: the invoice callback or the return page names a payment, and the server
   * re-reads the invoice from Moyasar's API with the secret key (rule 5 — the posted body and the
   * browser redirect are never trusted). Safe to call twice: a settled payment is left alone.
   */
  async confirmMoyasar(reference: { paymentId?: string; invoiceId?: string }, now = Date.now()): Promise<{ id: string | null; status: PaymentStatus | null }> {
    if (!this.deps.gateway.confirmInvoice) return { id: null, status: null };
    const payment = (await this.load()).find(
      (entry) =>
        entry.provider === 'moyasar' &&
        ((reference.paymentId !== undefined && entry.id === reference.paymentId) || (reference.invoiceId !== undefined && entry.intentionId === reference.invoiceId)),
    );
    if (!payment) {
      this.deps.log.warn(reference, 'moyasar callback for an unknown payment');
      return { id: null, status: null };
    }
    if (payment.status !== 'created') return { id: payment.id, status: payment.status };
    const invoice = await this.deps.gateway.confirmInvoice(payment.intentionId);
    if (invoice.status === 'pending') return { id: payment.id, status: payment.status };
    const settled = await this.mutate((entries) => {
      const entry = entries.find((candidate) => candidate.id === payment.id);
      if (!entry || entry.status !== 'created') return null;
      const stamp = new Date(now).toISOString();
      entry.transactionId = invoice.transactionId;
      entry.updatedAt = stamp;
      if (invoice.status === 'paid' && invoice.amount === entry.amountCents) {
        entry.status = 'paid';
        entry.paidAt = stamp;
        entry.failureReason = null;
      } else {
        entry.status = 'failed';
        entry.failedAt = stamp;
        entry.failureReason = invoice.status === 'paid' ? `amount mismatch (${invoice.amount})` : (invoice.failureReason ?? 'declined');
      }
      return entry;
    }, now);
    if (!settled) return { id: payment.id, status: payment.status };
    await this.announceSettled(settled, now);
    return { id: settled.id, status: settled.status };
  }

  /** The browser redirect after checkout. The stored status is what counts; the redirect only shapes the page. */
  async redirectResult(query: Record<string, string>): Promise<RedirectResult> {
    const verified = verifyRedirect(query, this.deps.hmacSecret);
    const reference = query.payment ?? query.merchant_order_id ?? '';
    // Moyasar sends no signed redirect: a still-pending payment is confirmed against the API right now.
    if (reference) await this.confirmMoyasar({ paymentId: reference }).catch(() => undefined);
    const payments = await this.load();
    const payment = payments.find((entry) => entry.id === reference) ?? (query.order ? payments.find((entry) => entry.orderId === query.order) : undefined) ?? null;
    return { payment: payment ? this.toPublic(payment) : null, verified, gatewaySuccess: verified ? query.success === 'true' : null };
  }

  async get(contactId: number, id: string): Promise<PublicPayment> {
    const payment = (await this.load()).find((entry) => entry.id === id && entry.contactId === contactId);
    if (!payment) throw new RequestError('not_found', 'العملية غير موجودة', 404);
    return this.toPublic(payment);
  }

  async list(contactId: number): Promise<PublicPayment[]> {
    return (await this.load())
      .filter((entry) => entry.contactId === contactId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((entry) => this.toPublic(entry));
  }

  async adminList(status: PaymentStatus | null): Promise<AdminPayment[]> {
    return (await this.load())
      .filter((entry) => !status || entry.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((entry) => this.toAdmin(entry));
  }

  async dailyStats(days: number, now = Date.now()): Promise<PaymentStats> {
    const today = riyadhDay(now);
    const series = new Map(lastRiyadhDays(days, now).map((day) => [day, { day, count: 0, cents: 0, paid: 0 }]));
    const month: PaymentTotals = { count: 0, cents: 0, paid: 0 };
    for (const payment of await this.load()) {
      const createdDay = riyadhDay(Date.parse(payment.createdAt));
      const paidDay = payment.status === 'paid' && payment.paidAt ? riyadhDay(Date.parse(payment.paidAt)) : null;
      const created = series.get(createdDay);
      if (created) created.count += 1;
      const paid = paidDay ? series.get(paidDay) : undefined;
      if (paid) {
        paid.paid += 1;
        paid.cents += payment.amountCents;
      }
      if (createdDay.slice(0, 7) === today.slice(0, 7)) month.count += 1;
      if (paidDay?.slice(0, 7) === today.slice(0, 7)) {
        month.paid += 1;
        month.cents += payment.amountCents;
      }
    }
    const { day: _day, ...todayTotals } = series.get(today) ?? { day: today, count: 0, cents: 0, paid: 0 };
    return { series: [...series.values()], today: todayTotals, month };
  }

  /** Mock gateway page only: a payment by id without an owner check (the page shows no personal data). */
  async peek(id: string): Promise<PublicPayment | null> {
    if (this.mode !== 'mock') return null;
    const payment = (await this.load()).find((entry) => entry.id === id);
    return payment ? this.toPublic(payment) : null;
  }

  /** Mock gateway only: completes a payment the way Paymob would (signed callback, then the signed redirect query). */
  async mockComplete(id: string, success: boolean, now = Date.now()): Promise<Record<string, string>> {
    if (this.mode !== 'mock') throw new RequestError('not_found', 'المسار غير موجود', 404);
    const payment = (await this.load()).find((entry) => entry.id === id);
    if (!payment) throw new RequestError('not_found', 'العملية غير موجودة', 404);
    const obj: Json = {
      id: 900_000 + Number(payment.orderId),
      pending: false,
      amount_cents: payment.amountCents,
      success,
      is_auth: false,
      is_capture: false,
      is_standalone_payment: true,
      is_voided: false,
      is_refunded: false,
      is_3d_secure: true,
      integration_id: 1,
      has_parental_supervision: false,
      order: { id: Number(payment.orderId), merchant_order_id: payment.id },
      created_at: new Date(now).toISOString(),
      currency: payment.currency,
      source_data: { pan: '2346', type: 'card', sub_type: 'MasterCard' },
      error_occured: false,
      owner: 1,
      data: { message: success ? 'Approved' : 'Declined by the test gateway' },
    };
    await this.handleWebhook({ type: 'TRANSACTION', obj }, webhookDigest(obj, this.deps.hmacSecret), now);
    const query = toRedirectQuery(obj);
    query.hmac = redirectDigest(query, this.deps.hmacSecret);
    query.payment = payment.id;
    return query;
  }
}
