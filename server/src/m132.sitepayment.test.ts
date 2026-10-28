import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubPayment, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';
import { sign } from './webhooks/signature.js';

// M132a (owner: «لو حد دفع من السايت نفس الفاتورة زي ابليكشن»): a payment the hub recorded on the site reaches the
// server as `payment.recorded` (ids only); the server asks the hub for the row (`payment_get`) and issues the same
// numbered invoice the app issues. Test-only secret (rule 1).
const HUB_SECRET = 'test-hub-webhook-secret-m132-01';

const sitePayment: HubPayment & { lang?: string } = {
  id: 7701,
  txn_id: '337701',
  order_id: '917701',
  amount_cents: 190_000,
  currency: 'SAR',
  success: 1,
  action: 'membership',
  name: 'عميل الموقع',
  phone: '0551234567',
  email: 'm132.site+member@gmail.com',
  contact_id: 0,
  note: 'العضوية السنوية — من الموقع',
  created_at: '2026-10-28 09:15:00',
  lang: 'ar',
};

/** The mock hub plus a hand-written `payment_get`, so the test does not depend on the demo seed's ids. */
class SiteHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly ops: HubOp[] = [];
  private readonly inner = new MockHubClient();

  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    this.ops.push(op);
    if (op === 'payment_get') {
      if (Number(body.id) === sitePayment.id) return { ok: true, payment: sitePayment } as unknown as HubResponse;
      if (Number(body.id) === 7702) return { ok: true, payment: { ...sitePayment, id: 7702, txn_id: '337702', success: 0 } } as unknown as HubResponse;
      throw new Error('unknown payment');
    }
    return this.inner.call(op, body);
  }
}

const hub = new SiteHub();
const mailer = new LogMailer();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', HUB_WEBHOOK_SECRET: HUB_SECRET });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let token = '';

function hook(event: string, data: Record<string, unknown>) {
  const body = JSON.stringify({ event, at: new Date().toISOString(), data });
  const timestamp = String(Math.floor(Date.now() / 1000));
  return app.inject({ method: 'POST', url: '/api/webhooks/hub', payload: body, headers: { 'content-type': 'application/json', 'x-vai-timestamp': timestamp, 'x-vai-signature': sign(HUB_SECRET, timestamp, body) } });
}

before(async () => {
  app = (await buildApp({ config, kv: new MemoryKV(), hub, mailer })).app;
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'أدمن الفواتير', country: 'sa', phone: '0558318722', email: 'm132.admin+member@gmail.com', password: 'secret123', persona: 'investor', bio: 'حساب يراجع فواتير الموقع.' } });
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  assert.equal(verified.statusCode, 200, verified.body);
  token = verified.json().token as string;
});

after(async () => {
  await app.close();
});

test('a successful site payment becomes a paid app payment with a numbered invoice, mailed once', async () => {
  const mailsBefore = mailer.sent.length;
  const first = await hook('payment.recorded', { id: sitePayment.id, action: 'membership', success: 1, amount_cents: 190_000, currency: 'SAR', n: 1 });
  assert.equal(first.statusCode, 200, first.body);
  assert.ok(hub.ops.includes('payment_get'), 'the server asked the hub for the payment row');

  const list = await app.inject({ method: 'GET', url: '/api/admin/payments', headers: { authorization: `Bearer ${token}` } });
  assert.equal(list.statusCode, 200, list.body);
  const rows = list.json().payments as { provider: string; status: string; invoiceNo: number | null; amount: number; serviceKey: string; serviceTitle: string; email: string; transactionId: string | null }[];
  const site = rows.filter((row) => row.provider === 'hub');
  assert.equal(site.length, 1);
  const row = site[0]!;
  assert.equal(row.status, 'paid');
  assert.equal(row.amount, 1900);
  assert.equal(row.serviceKey, 'site:membership');
  assert.equal(row.serviceTitle, 'العضوية السنوية لنادي المستثمرين');
  assert.equal(row.transactionId, '337701');
  assert.ok(row.invoiceNo && row.invoiceNo >= 10001, `invoice numbered: ${row.invoiceNo}`);

  const invoiceMails = mailer.sent.slice(mailsBefore).filter((mail) => mail.to.includes(sitePayment.email));
  assert.equal(invoiceMails.length, 1, 'the customer got exactly one invoice mail');
  assert.match(invoiceMails[0]!.subject, new RegExp(String(row.invoiceNo)));

  // The hub may deliver the same event twice (its queue retries): no second payment, no second invoice.
  const again = await hook('payment.recorded', { id: sitePayment.id, action: 'membership', success: 1, n: 2 });
  assert.equal(again.statusCode, 200);
  const list2 = await app.inject({ method: 'GET', url: '/api/admin/payments', headers: { authorization: `Bearer ${token}` } });
  assert.equal((list2.json().payments as { provider: string }[]).filter((row) => row.provider === 'hub').length, 1);
  assert.equal(mailer.sent.slice(mailsBefore).filter((mail) => mail.to.includes(sitePayment.email)).length, 1);
});

test('a failed site payment and an unknown id change nothing, and the webhook still answers 200', async () => {
  const opsBefore = hub.ops.length;
  const failed = await hook('payment.recorded', { id: 7702, action: 'membership', success: 0, n: 3 });
  assert.equal(failed.statusCode, 200);
  assert.equal(hub.ops.slice(opsBefore).filter((op) => op === 'payment_get').length, 0, 'a failed payment is not fetched');
  const unknown = await hook('payment.recorded', { id: 9999, action: 'workshop', success: 1, n: 4 });
  assert.equal(unknown.statusCode, 200, 'a hub error is logged, never a 5xx');
  const list = await app.inject({ method: 'GET', url: '/api/admin/payments', headers: { authorization: `Bearer ${token}` } });
  assert.equal((list.json().payments as { provider: string }[]).filter((row) => row.provider === 'hub').length, 1);
});
