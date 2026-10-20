import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MOCK_CODE, MockHubClient } from '../hub/mock.js';
import { LogMailer } from '../mail/mailer.js';
import { MemoryKV } from '../store.js';
import { LiveMoyasar, moyasarKeyMode, type MoyasarConfirmer, type MoyasarInvoiceState } from './moyasar.js';
import type { Intention, IntentionInput, PaymobGateway } from './paymob.js';

// Moyasar (2026-10-20): invoices behind the shared gateway interface. Rule 5 holds — the callback
// and the return page settle nothing by themselves; only the API-read invoice does.

const silentLog = { error() {}, warn() {}, info() {}, debug() {}, trace() {}, fatal() {}, child() { return silentLog; } } as never;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('createIntention posts a Moyasar invoice (halalas, basic auth, per-payment URLs) and maps the answer', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const gateway = new LiveMoyasar({
    baseUrl: 'https://api.moyasar.com',
    secretKey: 'sk_test_abcdefghijklmnop',
    log: silentLog,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(201, { id: 'inv_1', status: 'initiated', amount: 250_000, url: 'https://invoice.moyasar.com/inv_1' });
    },
  });
  const input: IntentionInput = {
    paymentId: 'pay-1',
    amountCents: 250_000,
    currency: 'SAR',
    itemName: 'إعداد عرض استثماري',
    description: 'ignored by moyasar',
    customer: { firstName: 'عضو', lastName: 'النادي', email: 'member@vcmem.com', phone: '0500000000' },
    notificationUrl: 'https://api.example.com/api/payments/moyasar/callback?payment=pay-1',
    redirectionUrl: 'https://api.example.com/pay/return?payment=pay-1',
    extras: { app: 'investorsclub', payment: 'pay-1' },
  };
  const intention = await gateway.createIntention(input);
  assert.deepEqual(intention, { intentionId: 'inv_1', orderId: 'inv_1', clientSecret: '', checkoutUrl: 'https://invoice.moyasar.com/inv_1' });
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, 'https://api.moyasar.com/v1/invoices');
  assert.equal(call.init.method, 'POST');
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Basic ${Buffer.from('sk_test_abcdefghijklmnop:').toString('base64')}`);
  const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
  assert.equal(body.amount, 250_000);
  assert.equal(body.currency, 'SAR');
  assert.equal(body.description, 'إعداد عرض استثماري');
  assert.equal(body.callback_url, input.notificationUrl);
  assert.equal(body.success_url, input.redirectionUrl);
  assert.ok(typeof body.expired_at === 'string');
});

test('confirmInvoice maps paid, pending and failed invoice states', async () => {
  const answers: Record<string, unknown> = {};
  const gateway = new LiveMoyasar({
    baseUrl: 'https://api.moyasar.com',
    secretKey: 'sk_test_abcdefghijklmnop',
    log: silentLog,
    fetchImpl: async (url) => jsonResponse(200, answers[String(url).split('/').at(-1) ?? ''] ?? {}),
  });
  answers.paid = { id: 'paid', status: 'paid', amount: 1000, payments: [{ id: 'tr_9', status: 'paid' }] };
  assert.deepEqual(await gateway.confirmInvoice('paid'), { status: 'paid', amount: 1000, transactionId: 'tr_9', failureReason: null });
  answers.open = { id: 'open', status: 'initiated', amount: 1000, payments: [] };
  assert.equal((await gateway.confirmInvoice('open')).status, 'pending');
  answers.gone = { id: 'gone', status: 'expired', amount: 1000, payments: [{ id: 'tr_1', status: 'failed', source: { message: 'INSUFFICIENT FUNDS' } }] };
  const gone = await gateway.confirmInvoice('gone');
  assert.deepEqual([gone.status, gone.failureReason], ['failed', 'INSUFFICIENT FUNDS']);
});

test('the Moyasar secret key switches the configured gateway; the key prefix names the mode', () => {
  const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', MOYASAR_SECRET_KEY: 'sk_live_abcdefghijklmnop' });
  assert.equal(config.GATEWAY, 'moyasar');
  assert.equal(moyasarKeyMode('sk_live_abcdefghijklmnop'), 'live');
  assert.equal(moyasarKeyMode('sk_test_abcdefghijklmnop'), 'test');
  assert.equal(moyasarKeyMode(undefined), null);
  assert.equal(loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock' }).GATEWAY, 'mock');
});

// ——— Integration: the server settles only from the API-read invoice ———

/** The gateway as the tests see it: every invoice state is set by hand. */
class FakeMoyasar implements PaymobGateway, MoyasarConfirmer {
  readonly mode = 'live' as const;
  readonly provider = 'moyasar' as const;
  readonly created: IntentionInput[] = [];
  readonly invoices = new Map<string, MoyasarInvoiceState>();
  private counter = 0;

  async createIntention(input: IntentionInput): Promise<Intention> {
    this.counter += 1;
    const id = `inv_${this.counter}`;
    this.created.push(input);
    this.invoices.set(id, { status: 'pending', amount: input.amountCents, transactionId: null, failureReason: null });
    return { intentionId: id, orderId: id, clientSecret: '', checkoutUrl: `https://invoice.moyasar.com/${id}` };
  }

  async confirmInvoice(invoiceId: string): Promise<MoyasarInvoiceState> {
    const state = this.invoices.get(invoiceId);
    if (!state) throw new Error(`unknown invoice ${invoiceId}`);
    return state;
  }
}

const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com', AUTO_PUSH: '0', PUBLIC_URL: 'http://localhost:3000' });
const fake = new FakeMoyasar();
const mailer = new LogMailer();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const post = (url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method: 'POST', url, ...(payload ? { payload } : {}), headers: bearer(token) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub: new MockHubClient(), mailer, gateway: fake });
  app = built.app;
  const registered = await post('/api/auth/register', { name: 'عميل ميسر', country: 'sa', phone: '0558619901', email: 'moyasar.admin@gmail.com', password: 'secret123', persona: 'investor', bio: 'حساب اختبار بوابة ميسر للمدفوعات.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  adminToken = verified.json().token as string;
});

after(async () => {
  await app.close();
});

async function startLinkPayment(amountSar: number): Promise<{ paymentId: string; invoiceId: string }> {
  const created = await post('/api/admin/paylinks', { kind: 'other', label: 'خدمة اختبار ميسر', amountSar, customer: { name: 'عميل ميسر', phone: '0558619901', email: 'moyasar.admin@gmail.com' } }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  const paymentId = created.json().link.paymentId as string;
  const payment = await built.payments.byId(paymentId);
  assert.ok(payment);
  return { paymentId, invoiceId: payment.intentionId };
}

test('a payment through Moyasar records the invoice and the per-payment callback URL', async () => {
  const { paymentId, invoiceId } = await startLinkPayment(150);
  const payment = await built.payments.byId(paymentId);
  assert.equal(payment?.provider, 'moyasar');
  assert.equal(payment?.checkoutUrl, `https://invoice.moyasar.com/${invoiceId}`);
  const sent = fake.created.at(-1);
  assert.equal(sent?.notificationUrl, `http://localhost:3000/api/payments/moyasar/callback?payment=${paymentId}`);
  assert.equal(sent?.redirectionUrl, `http://localhost:3000/pay/return?payment=${paymentId}`);

  // The callback alone settles nothing while the API still says pending (rule 5).
  const early = await post(`/api/payments/moyasar/callback?payment=${paymentId}`, { id: invoiceId, status: 'paid' });
  assert.equal(early.statusCode, 200);
  assert.equal((await built.payments.byId(paymentId))?.status, 'created');

  // Once the API answers paid, the callback settles it.
  fake.invoices.set(invoiceId, { status: 'paid', amount: 15_000, transactionId: 'tr_ok', failureReason: null });
  const confirmed = await post(`/api/payments/moyasar/callback?payment=${paymentId}`, { id: invoiceId });
  assert.equal(confirmed.statusCode, 200);
  await settle();
  const paid = await built.payments.byId(paymentId);
  assert.deepEqual([paid?.status, paid?.transactionId], ['paid', 'tr_ok']);
});

test('an amount mismatch from the API fails the payment instead of paying it', async () => {
  const { paymentId, invoiceId } = await startLinkPayment(200);
  fake.invoices.set(invoiceId, { status: 'paid', amount: 999, transactionId: 'tr_bad', failureReason: null });
  await post(`/api/payments/moyasar/callback?payment=${paymentId}`, { id: invoiceId });
  const payment = await built.payments.byId(paymentId);
  assert.deepEqual([payment?.status, payment?.failureReason], ['failed', 'amount mismatch (999)']);
});

test('the return page confirms a pending Moyasar payment against the API before rendering', async () => {
  const { paymentId, invoiceId } = await startLinkPayment(300);
  fake.invoices.set(invoiceId, { status: 'paid', amount: 30_000, transactionId: 'tr_ret', failureReason: null });
  const page = await get(`/pay/return?payment=${paymentId}`);
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes('تم الدفع بنجاح'), page.body.slice(0, 400));
  assert.equal((await built.payments.byId(paymentId))?.status, 'paid');
});

test('a permanent link mints a fresh invoice per visitor and every sale settles on its own', async () => {
  const created = await post('/api/admin/paylinks', { kind: 'other', label: 'رابط دائم للاختبار', amountSar: 100, permanent: true }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  const link = created.json().link as { id: string; permanent: boolean; checkoutUrl: string };
  assert.equal(link.permanent, true);
  assert.ok(link.checkoutUrl.endsWith(`/pay/link/${link.id}`), link.checkoutUrl);

  const first = await get(`/pay/link/${link.id}`);
  const second = await get(`/pay/link/${link.id}`);
  assert.deepEqual([first.statusCode, second.statusCode], [302, 302]);
  assert.notEqual(first.headers.location, second.headers.location);

  // The second visitor pays: that sale settles by itself and stamps the link.
  const invoiceId = String(second.headers.location).split('/').at(-1) ?? '';
  fake.invoices.set(invoiceId, { status: 'paid', amount: 10_000, transactionId: 'tr_perm', failureReason: null });
  await post('/api/payments/moyasar/callback', { id: invoiceId });
  await settle();
  const listed = await get('/api/admin/paylinks', adminToken);
  const row = (listed.json().links as { id: string; paidAt: string | null }[]).find((entry) => entry.id === link.id);
  assert.ok(row?.paidAt);

  const missing = await get('/pay/link/00000000-0000-4000-8000-000000000000');
  assert.equal(missing.statusCode, 404);
});

test('a callback that names nothing known answers ok and settles nothing', async () => {
  const unknown = await post('/api/payments/moyasar/callback', { id: 'inv_unknown' });
  assert.equal(unknown.statusCode, 200);
  assert.deepEqual(unknown.json(), { ok: true, id: null, status: null });
});
