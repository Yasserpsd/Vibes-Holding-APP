import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import { priceFor, toPublicService, type ServicesContent } from '../content/services.js';
import type { Notifier, PaymentLike } from '../mail/notify.js';
import type { PushService } from '../push/service.js';
import { lastRiyadhDays, riyadhDay } from '../riyadh.js';
import type { KV } from '../store.js';
import { redirectDigest, toRedirectQuery, verifyRedirect, verifyWebhook, webhookDigest, type Json } from './hmac.js';
import type { PaymobGateway } from './paymob.js';

/**
 * In-app payments for real-world services (CLAUDE.md rule 3): the server creates the Paymob intention,
 * the app opens the checkout, and only Paymob's HMAC-verified callback marks a payment paid (rule 5).
 * Payments live in one kv document (single-instance server, writes serialized in process).
 */
export const PAYMENTS_KEY = 'payments:orders';
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
  provider: 'paymob' | 'mock';
  intentionId: string;
  orderId: string;
  clientSecret: string;
  checkoutUrl: string;
  transactionId: string | null;
  failureReason: string | null;
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
  | 'checkoutUrl'
  | 'transactionId'
  | 'failureReason'
  | 'createdAt'
  | 'paidAt'
  | 'failedAt'
>;

export type AdminPayment = PublicPayment & Pick<Payment, 'contactId' | 'name' | 'email' | 'phone' | 'orderId' | 'intentionId'>;

/** Dashboard home: payments per Riyadh day. `count` = created that day, `paid` and `cents` = paid that day. */
export type PaymentTotals = { count: number; cents: number; paid: number };
export type PaymentStats = { series: ({ day: string } & PaymentTotals)[]; today: PaymentTotals; month: PaymentTotals };

export type RedirectResult = { payment: PublicPayment | null; verified: boolean; gatewaySuccess: boolean | null };

type Deps = { kv: KV; log: FastifyBaseLogger; gateway: PaymobGateway; notifier: Notifier; push: PushService; hmacSecret: string; publicUrl: string };

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
      checkoutUrl: payment.checkoutUrl,
      transactionId: payment.transactionId,
      failureReason: payment.failureReason,
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

  /** Shared core: creates the gateway intention and records the payment as created (rule 5: only the webhook pays it). */
  private async createPayment(customer: { contactId: number; name: string; email: string; phone: string }, input: { key: string; title: string; answers: Answer[]; amount: number; currency: string; memberPrice: boolean }, now: number): Promise<Payment> {
    const id = randomUUID();
    const [firstName = '', ...rest] = customer.name.trim().split(/\s+/);
    const intention = await this.deps.gateway.createIntention({
      paymentId: id,
      amountCents: input.amount * 100,
      currency: input.currency,
      itemName: input.title,
      description: `${input.title} — تطبيق نادي المستثمرين`,
      customer: { firstName, lastName: rest.join(' '), email: customer.email || 'no-reply@vcmem.com', phone: customer.phone || '0500000000' },
      notificationUrl: `${this.deps.publicUrl}/api/payments/paymob/webhook`,
      redirectionUrl: `${this.deps.publicUrl}/pay/return?payment=${id}`,
      extras: { app: 'investorsclub', payment: id, service: input.key, contact: String(customer.contactId) },
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
      answers: input.answers,
      amount: input.amount,
      amountCents: input.amount * 100,
      currency: input.currency,
      memberPrice: input.memberPrice,
      status: 'created',
      provider: this.mode === 'mock' ? 'mock' : 'paymob',
      intentionId: intention.intentionId,
      orderId: intention.orderId,
      clientSecret: intention.clientSecret,
      checkoutUrl: intention.checkoutUrl,
      transactionId: null,
      failureReason: null,
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
  async start(me: Me, serviceKey: string, rawAnswers: Record<string, string>, content: ServicesContent, now = Date.now()): Promise<PublicPayment> {
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
    const payment = await this.createPayment(
      { contactId: me.id, name: me.name, email: me.email, phone: me.phone },
      { key: service.key, title: service.title, answers, amount: price.amount, currency: price.currency, memberPrice: price.memberPrice },
      now,
    );
    return this.toPublic(payment);
  }

  /** M41 «أجندة النادي»: the attendance fee of a visitor without an active membership (a real-world service, rule 3 intact). */
  async startAgenda(me: Me, input: { eventId: string; eventTitle: string; attendanceLabel: string; amountSar: number }, now = Date.now()): Promise<PublicPayment> {
    const payment = await this.createPayment(
      { contactId: me.id, name: me.name, email: me.email, phone: me.phone },
      {
        key: `agenda:${input.eventId}`,
        title: `حضور فعالية: ${input.eventTitle}`,
        answers: [{ key: 'attendance', label: 'طريقة الحضور', value: input.attendanceLabel }],
        amount: input.amountSar,
        currency: 'SAR',
        memberPrice: false,
      },
      now,
    );
    return this.toPublic(payment);
  }

  /**
   * M44 «روابط الدفع»: the owner sells by a link he creates in the dashboard (a real-world sale outside
   * the app — never shown inside it, rule 3 intact). The customer may hold no app account at all.
   */
  async startLink(input: { kind: string; label: string; amountSar: number; customer: { contactId: number; name: string; email: string; phone: string } }, now = Date.now()): Promise<Payment> {
    return this.createPayment(
      input.customer,
      { key: `link:${input.kind}`, title: input.label, answers: [], amount: input.amountSar, currency: 'SAR', memberPrice: false },
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
    if (result.changed) {
      this.deps.log.info({ payment: result.payment.id, status: result.payment.status }, 'payment updated from the gateway callback');
      // M44: a payment-link sale gets its own richer mail from the links listener instead of the generic one.
      const linkSale = result.payment.serviceKey.startsWith('link:');
      if (result.payment.status === 'paid' && !linkSale) this.deps.notifier.paymentPaid(this.toMail(result.payment));
      else if (result.payment.status !== 'paid' && !linkSale) this.deps.notifier.paymentFailed(this.toMail(result.payment));
      if (result.payment.status === 'paid' || result.payment.status === 'failed') {
        const { id, contactId, serviceTitle, amount, currency, status } = result.payment;
        this.deps.push.paymentResult({ id, contactId, serviceTitle, amount, currency, status });
        for (const listener of this.settledListeners) {
          try {
            listener(result.payment);
          } catch (error) {
            this.deps.log.error({ err: error, payment: id }, 'payment settled listener failed');
          }
        }
      }
    }
    return { ok: true, id: result.payment.id, status: result.payment.status };
  }

  /** The browser redirect after checkout. The stored status is what counts; the redirect only shapes the page. */
  async redirectResult(query: Record<string, string>): Promise<RedirectResult> {
    const verified = verifyRedirect(query, this.deps.hmacSecret);
    const payments = await this.load();
    const reference = query.payment ?? query.merchant_order_id ?? '';
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
