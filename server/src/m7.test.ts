import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { webhookDigest } from './payments/hmac.js';
import { MOCK_HMAC_SECRET } from './payments/paymob.js';
import { MemoryKV } from './store.js';
import { TemplateBlurbWriter } from './videos/blurbs.js';

const config = loadConfig({
  LOG_LEVEL: 'silent',
  HUB_MODE: 'mock',
  NEWS_REFRESH_MINUTES: '0',
  VIDEOS_REFRESH_MINUTES: '0',
  PUBLIC_URL: 'http://localhost:3000',
  NOTIFY_EMAIL: 'admin@vcmem.com, second@vcmem.com',
  REVENUECAT_WEBHOOK_AUTH: 'test-webhook-secret-123',
});
const kv = new MemoryKV();
const mailer = new LogMailer();
let built: BuiltApp;
let app: BuiltApp['app'];

const fetchStub: typeof fetch = async (input) => {
  throw new Error(`unexpected fetch ${String(input)}`);
};

const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const post = (url: string, payload: Record<string, unknown>, token?: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

async function signUp(email: string, phone: string): Promise<string> {
  const registered = await post('/api/auth/register', {
    name: 'عضو تجريبي',
    country: 'sa',
    phone,
    email,
    password: 'secret123',
    persona: 'investor',
    bio: 'مستثمر مهتم بفرص الشراكة في قطاع التقنية.',
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return verified.json().token as string;
}

const lastMail = () => mailer.sent[mailer.sent.length - 1];

let memberToken = '';
let unactivatedToken = '';

before(async () => {
  built = await buildApp({ config, kv, hub: new MockHubClient(), blurbs: new TemplateBlurbWriter(), fetchImpl: fetchStub, mailer });
  app = built.app;
  memberToken = await signUp('m7+member@gmail.com', '0558318790');
  unactivatedToken = await signUp('m7.guest@gmail.com', '0558318791');
});

after(async () => {
  await app.close();
});

test('content: one annual membership name, HQ open 10:00 to 19:00, two services priced for Paymob', async () => {
  const membership = await get('/api/membership');
  assert.equal(membership.json().title, 'العضوية السنوية لنادي المستثمرين');
  const home = await get('/api/home');
  assert.equal(home.json().membership.title, 'العضوية السنوية لنادي المستثمرين');
  assert.ok(!`${membership.body}${home.body}`.includes('العضوية الذهبية'));

  const hq = await get('/api/hq');
  assert.equal(hq.json().content.hours.close, '19:00');
  assert.deepEqual([hq.json().times[0], hq.json().times.at(-1), hq.json().times.length], ['10:00', '18:00', 9]);

  const guest = await get('/api/services');
  const services = guest.json().services as { key: string; action: { type: string } | null; price: { amount: number; memberPrice: boolean } | null }[];
  const pitch = services.find((service) => service.key === 'pitch-deck');
  const meetup = services.find((service) => service.key === 'meetup');
  assert.equal(pitch?.action?.type, 'paymob');
  assert.deepEqual([pitch?.price?.amount, pitch?.price?.memberPrice], [5000, false]);
  assert.deepEqual([meetup?.price?.amount, meetup?.price?.memberPrice], [30000, false]);

  const member = await get('/api/services/pitch-deck', memberToken);
  assert.deepEqual([member.json().service.price.amount, member.json().service.price.memberPrice], [2500, true]);
  const meetupMember = await get('/api/services/meetup', memberToken);
  assert.equal(meetupMember.json().service.price.amount, 15000);
});

test('service requests e-mail the management before the WhatsApp handover', async () => {
  const before = mailer.sent.length;
  const ok = await post('/api/services/studio/request', { answers: { package: 'الكاملة', time: 'الثلاثاء 4 عصرًا' } }, memberToken);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(mailer.sent.length, before + 1);
  const mail = lastMail();
  assert.deepEqual(mail.to, ['admin@vcmem.com', 'second@vcmem.com']);
  assert.ok(mail.subject.startsWith('[Vibes AI] [تجريبي] طلب خدمة من التطبيق:'), mail.subject);
  assert.ok(mail.text.includes('الباقة: الكاملة') && mail.text.includes('الاسم: عضو تجريبي'), mail.text);

  const locked = await post('/api/services/studio/request', { answers: {} });
  assert.equal(locked.statusCode, 403);
  const paid = await post('/api/services/pitch-deck/request', { answers: {} }, memberToken);
  assert.equal(paid.statusCode, 403);
});

test('HQ: booking, decisions and cancellations e-mail the management; the pass carries the holder name', async () => {
  const hq = await get('/api/hq', memberToken);
  const [first, second] = hq.json().days as { date: string }[];
  const purpose = hq.json().content.purposes[0] as string;

  const booked = await post('/api/hq/visits', { date: first.date, time: '18:00', purpose, note: 'اجتماع مع شريك' }, memberToken);
  assert.equal(booked.statusCode, 200, booked.body);
  let mail = lastMail();
  assert.ok(mail.subject.includes('حجز زيارة للمقر من التطبيق: عضو تجريبي'), mail.subject);
  assert.ok(mail.text.includes('الوقت: من 18:00 إلى 19:00') && mail.text.includes('ملاحظة العضو: اجتماع مع شريك'), mail.text);

  const visitId = booked.json().visit.id as string;
  const confirmed = await post(`/api/hq/visits/${visitId}/decision`.replace('/api/hq', '/api/admin/hq'), { status: 'confirmed', note: '' }, memberToken);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  mail = lastMail();
  assert.ok(mail.subject.includes('تأكيد زيارة للمقر: عضو تجريبي'), mail.subject);

  const pass = await get(`/api/hq/visits/${visitId}/pass`, memberToken);
  assert.equal(pass.statusCode, 200, pass.body);
  assert.equal(pass.json().pass.name, 'عضو تجريبي');
  assert.ok(pass.json().pass.visit.createdAt);

  const other = await post('/api/hq/visits', { date: second.date, time: '10:00', purpose, note: '' }, memberToken);
  assert.equal(other.statusCode, 200, other.body);
  const cancelled = await post(`/api/hq/visits/${other.json().visit.id}/cancel`, {}, memberToken);
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.ok(lastMail().subject.includes('إلغاء زيارة للمقر من التطبيق'), lastMail().subject);
});

test('payments: services are paid through the gateway; only the signed callback changes the status', async () => {
  const guest = await post('/api/payments', { serviceKey: 'pitch-deck', answers: {} });
  assert.equal(guest.statusCode, 401);
  const notPayable = await post('/api/payments', { serviceKey: 'studio', answers: {} }, memberToken);
  assert.equal(notPayable.statusCode, 403);

  const listPrice = await post('/api/payments', { serviceKey: 'pitch-deck', answers: { project: 'مشروعي', stage: 'فكرة' } }, unactivatedToken);
  assert.equal(listPrice.statusCode, 200, listPrice.body);
  const first = listPrice.json().payment;
  assert.deepEqual([first.amount, first.memberPrice, first.status, first.provider], [5000, false, 'created', 'mock']);
  assert.ok(String(first.checkoutUrl).startsWith('http://localhost:3000/pay/mock/'), first.checkoutUrl);
  assert.ok(lastMail().subject.includes('بدء دفع من التطبيق: تصميم Pitch Deck'), lastMail().subject);
  assert.ok(lastMail().text.includes('اسم المشروع: مشروعي'), lastMail().text);

  const memberPrice = await post('/api/payments', { serviceKey: 'pitch-deck', answers: { project: 'مشروع العضو' } }, memberToken);
  assert.equal(memberPrice.statusCode, 200, memberPrice.body);
  const second = memberPrice.json().payment;
  assert.deepEqual([second.amount, second.memberPrice], [2500, true]);

  const callback = (paymentId: string, amountCents: number, success: boolean) => ({
    id: 555,
    pending: false,
    amount_cents: amountCents,
    success,
    is_auth: false,
    is_capture: false,
    is_standalone_payment: true,
    is_voided: false,
    is_refunded: false,
    is_3d_secure: true,
    integration_id: 1,
    has_parental_supervision: false,
    order: { id: 0, merchant_order_id: paymentId },
    created_at: '2026-09-12T10:00:00Z',
    currency: 'SAR',
    source_data: { pan: '2346', type: 'card', sub_type: 'MasterCard' },
    error_occured: false,
    owner: 1,
    data: { message: success ? 'Approved' : 'Declined' },
  });

  const paidObj = callback(second.id, 250000, true);
  const forged = await post('/api/payments/paymob/webhook?hmac=deadbeef', { type: 'TRANSACTION', obj: paidObj });
  assert.equal(forged.statusCode, 401);
  const still = await get(`/api/payments/${second.id}`, memberToken);
  assert.equal(still.json().payment.status, 'created');

  const signed = await post(`/api/payments/paymob/webhook?hmac=${webhookDigest(paidObj, MOCK_HMAC_SECRET)}`, { type: 'TRANSACTION', obj: paidObj });
  assert.equal(signed.statusCode, 200, signed.body);
  assert.equal(signed.json().status, 'paid');
  const paid = await get(`/api/payments/${second.id}`, memberToken);
  assert.deepEqual([paid.json().payment.status, paid.json().payment.transactionId], ['paid', '555']);
  assert.ok(lastMail().subject.includes('دفع ناجح من التطبيق'), lastMail().subject);

  const wrongAmount = callback(first.id, 100, true);
  const mismatch = await post(`/api/payments/paymob/webhook?hmac=${webhookDigest(wrongAmount, MOCK_HMAC_SECRET)}`, { type: 'TRANSACTION', obj: wrongAmount });
  assert.equal(mismatch.json().status, 'failed');
  const failed = await get(`/api/payments/${first.id}`, unactivatedToken);
  assert.ok(String(failed.json().payment.failureReason).includes('amount mismatch'));
  assert.ok(lastMail().subject.includes('دفع غير مكتمل'), lastMail().subject);

  const foreign = await get(`/api/payments/${first.id}`, memberToken);
  assert.equal(foreign.statusCode, 404);
  const mine = await get('/api/payments', memberToken);
  assert.equal(mine.json().payments.length, 1);

  // Mock gateway page: the same signed callback, then the signed redirect to the return page.
  const meetup = await post('/api/payments', { serviceKey: 'meetup', answers: { topic: 'فرص التجزئة' } }, memberToken);
  const third = meetup.json().payment;
  const page = await get(`/pay/mock/${third.id}`);
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes('بوابة دفع تجريبية') && page.body.includes('15,000'), page.body.slice(0, 200));
  const done = await app.inject({ method: 'POST', url: `/pay/mock/${third.id}/complete`, payload: 'result=success', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(done.statusCode, 303, done.body);
  const location = String(done.headers.location);
  assert.ok(location.startsWith('/pay/return?'), location);
  const back = await get(location);
  assert.equal(back.statusCode, 200);
  assert.ok(back.body.includes('تم الدفع بنجاح') && back.body.includes('investorsclub-preview://payment/'), back.body.slice(0, 300));
  const settled = await get(`/api/payments/${third.id}`, memberToken);
  assert.equal(settled.json().payment.status, 'paid');

  const admin = await get('/api/admin/payments?status=paid', memberToken);
  assert.equal(admin.statusCode, 200, admin.body);
  assert.equal(admin.json().payments.length, 2);
  assert.equal(admin.json().payments[0].name, 'عضو تجريبي');
});

test('store purchases: the RevenueCat webhook activates the membership and e-mails the management', async () => {
  const me = await get('/api/me', unactivatedToken);
  assert.equal(me.json().me.membership.status, 'unactivated');
  const contactId = me.json().me.id as number;
  const now = Date.now();
  const event = (id: string, type: string, appUserId: string) => ({
    api_version: '1.0',
    event: { id, type, app_user_id: appUserId, product_id: 'club_membership_annual', store: 'PLAY_STORE', environment: 'SANDBOX', purchased_at_ms: now, expiration_at_ms: now + 365 * 86_400_000, transaction_id: 'GPA.1234' },
  });

  const unauthorized = await post('/api/webhooks/revenuecat', event('ev-0', 'INITIAL_PURCHASE', `vc-${contactId}`));
  assert.equal(unauthorized.statusCode, 401);

  const activated = await post('/api/webhooks/revenuecat', event('ev-1', 'INITIAL_PURCHASE', `vc-${contactId}`), undefined, { authorization: 'Bearer test-webhook-secret-123' });
  assert.equal(activated.statusCode, 200, activated.body);
  assert.equal(activated.json().activation, 'activated');
  const after = await get('/api/me', unactivatedToken);
  assert.equal(after.json().me.membership.status, 'active');
  assert.ok(lastMail().subject.includes('تفعيل عضوية سنوية من المتجر'), lastMail().subject);
  assert.ok(lastMail().text.includes('المدة: 365 يومًا'), lastMail().text);

  const ignored = await post('/api/webhooks/revenuecat', event('ev-2', 'EXPIRATION', `vc-${contactId}`), undefined, { authorization: 'test-webhook-secret-123' });
  assert.equal(ignored.json().activation, 'ignored');
  const unknown = await post('/api/webhooks/revenuecat', event('ev-3', 'INITIAL_PURCHASE', 'vc-999999'), undefined, { authorization: 'test-webhook-secret-123' });
  assert.equal(unknown.json().activation, 'pending');
  assert.ok(lastMail().subject.includes('تحتاج تفعيلًا يدويًا'), lastMail().subject);

  const list = await get('/api/admin/membership/purchases', memberToken);
  assert.equal(list.json().events.length, 3);
});
