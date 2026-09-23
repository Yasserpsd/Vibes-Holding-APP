import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M44 «روابط الدفع»: the owner sells by a dashboard-made Paymob link; the HMAC webhook settles it,
// the mail says exactly what and who, and a matched MEMBERSHIP sale activates the hub account itself.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com', AUTO_PUSH: '0' });

class PlainHub implements HubClient {
  readonly mode = 'mock' as const;
  private readonly inner = new MockHubClient();
  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    return this.inner.call(op, body);
  }
}

const hub = new PlainHub();
const mailer = new LogMailer();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
let customerToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'عميل الروابط', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب اختبار روابط الدفع المباشرة.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  adminToken = (await signUp('m44.admin@gmail.com', '0558618871')).token;
  // The customer holds a REGISTERED but UNACTIVATED account: exactly the owner's «اعضاء عمالة تسجل» case.
  customerToken = (await signUp('m44.customer@gmail.com', '0558618872')).token;
  const me = await get('/api/me?fresh=1', customerToken);
  assert.notEqual(me.json().me.membership.status, 'active');
});

after(async () => {
  await app.close();
});

let membershipLink: { id: string; paymentId: string } = { id: '', paymentId: '' };

test('a membership link matches the hub account at creation and carries a checkout URL', async () => {
  const created = await send('POST', '/api/admin/paylinks', { kind: 'membership', amountSar: 1900, days: 365, customer: { name: 'عميل الروابط', phone: '0558618872', email: 'm44.customer@gmail.com' } }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  const link = created.json().link;
  membershipLink = { id: link.id, paymentId: link.paymentId };
  assert.ok(link.contactId > 0);
  assert.ok(link.checkoutUrl);
  assert.equal(link.activation, 'auto');
  assert.equal(link.activationNote, null);
  assert.match(link.label, /عضوية سنوية/);
});

test('the paid webhook activates the membership instantly and the mail says everything', async () => {
  const before = mailer.sent.length;
  await built.payments.mockComplete(membershipLink.paymentId, true);
  await settle();

  const listed = await get('/api/admin/paylinks', adminToken);
  const row = (listed.json().links as { id: string; status: string; paidAt: string | null; activation: string }[]).find((entry) => entry.id === membershipLink.id);
  assert.equal(row?.status, 'paid');
  assert.ok(row?.paidAt);
  assert.equal(row?.activation, 'done');

  const mail = mailer.sent.slice(before).map((entry) => entry.subject + '\n' + entry.text).join('\n---\n');
  assert.match(mail, /✅ دفعة عضوية سنوية/);
  assert.match(mail, /1900 ريال/);
  assert.match(mail, /تم تفعيل العضوية تلقائيًا/);

  // The customer is an active member the moment the webhook lands — nothing manual.
  const me = await get('/api/me?fresh=1', customerToken);
  assert.equal(me.json().me.membership.status, 'active');
});

test('a workshop link needs no activation and its mail names the sale', async () => {
  const created = await send('POST', '/api/admin/paylinks', { kind: 'workshop', label: 'ورشة مشروعك الريادي', amountSar: 290, customer: { name: 'ضيف الورشة', phone: '0558600001', email: '' } }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().link.activation, 'none');
  const before = mailer.sent.length;
  await built.payments.mockComplete(created.json().link.paymentId, true);
  await settle();
  const mail = mailer.sent.slice(before).map((entry) => entry.subject + '\n' + entry.text).join('\n');
  assert.match(mail, /✅ دفعة ورشة \/ فعالية: ورشة مشروعك الريادي — ضيف الورشة \(290 ريال\)/);
  assert.match(mail, /لا يلزم/);
  // The generic payment mail stays quiet for link sales: one clear mail per sale.
  assert.equal(mailer.sent.slice(before).length, 1);
});

test('a membership sale with no matched account is flagged for manual activation after payment', async () => {
  const created = await send('POST', '/api/admin/paylinks', { kind: 'membership', amountSar: 1900, customer: { name: 'عميل جديد تمامًا', phone: '0558699999', email: 'nobody@example.test' } }, adminToken);
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().link.contactId, null);
  assert.match(created.json().link.activationNote, /التفعيل يدوي/);
  const before = mailer.sent.length;
  await built.payments.mockComplete(created.json().link.paymentId, true);
  await settle();
  const mail = mailer.sent.slice(before).map((entry) => entry.subject + '\n' + entry.text).join('\n');
  assert.match(mail, /لم يتم تلقائيًا/);
});

test('a failed attempt mails once and the link stays usable', async () => {
  const created = await send('POST', '/api/admin/paylinks', { kind: 'other', label: 'خدمة خاصة', amountSar: 500, customer: { name: 'عميل متردد', phone: '', email: '' } }, adminToken);
  const before = mailer.sent.length;
  await built.payments.mockComplete(created.json().link.paymentId, false);
  await settle();
  const mails = mailer.sent.slice(before);
  assert.equal(mails.length, 1);
  assert.match(mails[0]?.subject ?? '', /محاولة دفع لم تكتمل/);
  const listed = await get('/api/admin/paylinks', adminToken);
  const row = (listed.json().links as { id: string; status: string }[]).find((entry) => entry.id === created.json().link.id);
  assert.equal(row?.status, 'failed');
});
