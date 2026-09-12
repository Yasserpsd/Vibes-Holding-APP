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

// M7 part 2 B: store membership settings and sync, member push notifications.
const config = loadConfig({
  LOG_LEVEL: 'silent',
  HUB_MODE: 'mock',
  NEWS_REFRESH_MINUTES: '0',
  VIDEOS_REFRESH_MINUTES: '0',
  PUBLIC_URL: 'http://localhost:3000',
  NOTIFY_EMAIL: 'admin@vcmem.com',
  REVENUECAT_WEBHOOK_AUTH: 'test-webhook-secret-123',
  REVENUECAT_PUBLIC_KEY_ANDROID: 'goog_test_public_key',
  REVENUECAT_SECRET_KEY: 'sk_test_secret_key_for_rest_check',
  STORE_TERMS_URL: 'https://vcmem.com/terms',
});
const kv = new MemoryKV();
const mailer = new LogMailer();
let built: BuiltApp;
let app: BuiltApp['app'];

type PushMessage = { to: string; title: string; body: string; data: Record<string, string>; channelId: string };
type Ticket = { status: 'ok'; id: string } | { status: 'error'; message: string; details: { error: string } };
const pushBatches: PushMessage[][] = [];
let ticketFor: (to: string) => Ticket = () => ({ status: 'ok', id: 'ticket' });
let subscriber: Record<string, unknown> | null = null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchStub: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://exp.host/--/api/v2/push/send') {
    const messages = JSON.parse(String(init?.body)) as PushMessage[];
    pushBatches.push(messages);
    return json({ data: messages.map((message) => ticketFor(message.to)) });
  }
  if (url.startsWith('https://api.revenuecat.com/v1/subscribers/')) {
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer sk_test_secret_key_for_rest_check');
    return subscriber ? json({ request_date_ms: Date.now(), subscriber }) : json({ message: 'down' }, 503);
  }
  throw new Error(`unexpected fetch ${url}`);
};

const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const post = (url: string, payload: Record<string, unknown>, token?: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
const del = (url: string, payload: Record<string, unknown>, token: string) => app.inject({ method: 'DELETE', url, payload, headers: { authorization: `Bearer ${token}` } });
const lastPush = () => {
  const batch = pushBatches.at(-1);
  if (!batch?.length) throw new Error('no push was sent');
  return batch[batch.length - 1] as PushMessage;
};

async function signUp(email: string, phone: string): Promise<string> {
  const registered = await post('/api/auth/register', { name: 'عضو تجريبي', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'مستثمر مهتم بفرص الشراكة في قطاع التقنية.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return verified.json().token as string;
}

const MEMBER_TOKEN = 'ExponentPushToken[member-device-0001]';
const SECOND_TOKEN = 'ExpoPushToken[member-tablet-0002]';
const GUEST_TOKEN = 'ExponentPushToken[guest-device-0003]';
let memberToken = '';
let unactivatedToken = '';
let syncToken = '';

before(async () => {
  built = await buildApp({ config, kv, hub: new MockHubClient(), blurbs: new TemplateBlurbWriter(), fetchImpl: fetchStub, mailer });
  app = built.app;
  memberToken = await signUp('m7b+member@gmail.com', '0558318792');
  unactivatedToken = await signUp('m7b.guest@gmail.com', '0558318793');
  syncToken = await signUp('m7b.sync@gmail.com', '0558318794');
});

after(async () => {
  await app.close();
});

test('store settings: public keys and product ids for the app, secrets stay out', async () => {
  const store = await get('/api/membership/store');
  assert.equal(store.statusCode, 200, store.body);
  assert.deepEqual(store.json(), {
    provider: 'revenuecat',
    productId: 'club_membership_annual',
    entitlement: 'membership',
    apiKeys: { android: 'goog_test_public_key', ios: null },
    appUserIdPrefix: 'vc-',
    environment: 'test',
    termsUrl: 'https://vcmem.com/terms',
    privacyUrl: null,
    restCheck: true,
  });
  assert.ok(!store.body.includes('sk_test'));
  const health = await get('/health');
  assert.deepEqual(health.json().membership.store, { android: true, ios: false, product: 'club_membership_annual', entitlement: 'membership', restCheck: true });
  assert.equal(health.json().push.tokens, 0);
});

test('push tokens: registered per device for the signed-in account, listed and dropped', async () => {
  assert.equal((await post('/api/push/tokens', { token: MEMBER_TOKEN, platform: 'android' })).statusCode, 401);
  const bad = await post('/api/push/tokens', { token: 'not-a-token-at-all', platform: 'android' }, memberToken);
  assert.equal(bad.statusCode, 400, bad.body);
  const first = await post('/api/push/tokens', { token: MEMBER_TOKEN, platform: 'android', deviceName: 'Pixel 8', appVersion: '1.0.0' }, memberToken);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().tokens, 1);
  const again = await post('/api/push/tokens', { token: MEMBER_TOKEN, platform: 'android' }, memberToken);
  assert.equal(again.json().tokens, 1);
  const second = await post('/api/push/tokens', { token: SECOND_TOKEN, platform: 'ios' }, memberToken);
  assert.equal(second.json().tokens, 2);

  const summary = await get('/api/admin/push/tokens', memberToken);
  assert.equal(summary.statusCode, 200, summary.body);
  assert.deepEqual(summary.json(), { total: 2, accounts: 1, byPlatform: { android: 1, ios: 1 } });
  // Every mock-hub account is an admin; only a missing session is refused here.
  assert.equal((await get('/api/admin/push/tokens')).statusCode, 401);

  const sent = await post('/api/admin/push/test', { title: 'إشعار تجريبي', body: 'مرحبًا' }, memberToken);
  assert.equal(sent.statusCode, 200, sent.body);
  assert.deepEqual([sent.json().sent, sent.json().failed], [2, 0]);
  const batch = pushBatches.at(-1) ?? [];
  assert.deepEqual(batch.map((message) => message.to).sort(), [SECOND_TOKEN, MEMBER_TOKEN].sort());
  assert.deepEqual([batch[0]?.title, batch[0]?.channelId, batch[0]?.data.screen], ['إشعار تجريبي', 'default', '/membership']);

  const removed = await del('/api/push/tokens', { token: SECOND_TOKEN }, memberToken);
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal((await get('/api/admin/push/tokens', memberToken)).json().total, 1);
});

test('HQ decision and payment result reach the member as push notifications', async () => {
  const hq = await get('/api/hq', memberToken);
  const date = hq.json().days[0].date as string;
  const time = hq.json().times[0] as string;
  const booked = await post('/api/hq/visits', { date, time, purpose: 'اجتماع عمل', note: '' }, memberToken);
  assert.equal(booked.statusCode, 200, booked.body);
  const visitId = booked.json().visit.id as string;
  const confirmed = await post(`/api/admin/hq/visits/${visitId}/decision`, { status: 'confirmed', note: 'أهلًا بك' }, memberToken);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  await built.push.idle();
  assert.equal(lastPush().to, MEMBER_TOKEN);
  assert.equal(lastPush().title, 'تم تأكيد زيارتك للمقر');
  assert.ok(lastPush().body.includes(`من ${time} إلى`), lastPush().body);
  assert.deepEqual(lastPush().data, { type: 'hq_visit', id: visitId, status: 'confirmed', screen: `/hq/pass/${visitId}` });

  const started = await post('/api/payments', { serviceKey: 'pitch-deck', answers: { project: 'مشروع العضو', stage: 'توسّع' } }, memberToken);
  assert.equal(started.statusCode, 200, started.body);
  const payment = started.json().payment;
  const obj = {
    id: 777, pending: false, amount_cents: payment.amountCents ?? 250000, success: true, is_auth: false, is_capture: false, is_standalone_payment: true, is_voided: false, is_refunded: false, is_3d_secure: true, integration_id: 1, has_parental_supervision: false,
    order: { id: 0, merchant_order_id: payment.id }, created_at: '2026-09-13T10:00:00Z', currency: 'SAR', source_data: { pan: '2346', type: 'card', sub_type: 'MasterCard' }, error_occured: false, owner: 1, data: { message: 'Approved' },
  };
  const paid = await post(`/api/payments/paymob/webhook?hmac=${webhookDigest(obj, MOCK_HMAC_SECRET)}`, { type: 'TRANSACTION', obj });
  assert.equal(paid.json().status, 'paid', paid.body);
  await built.push.idle();
  assert.equal(lastPush().title, 'تم الدفع بنجاح');
  assert.ok(lastPush().body.includes('2,500 ريال') && lastPush().body.includes('Pitch Deck'), lastPush().body);
  assert.deepEqual(lastPush().data, { type: 'payment', id: payment.id, status: 'paid', screen: `/payment/${payment.id}` });

  // Expo reports the device as gone: the token is dropped.
  ticketFor = () => ({ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } });
  const dropped = await post('/api/admin/push/test', {}, memberToken);
  assert.deepEqual([dropped.json().sent, dropped.json().failed, dropped.json().dropped], [0, 1, 1]);
  assert.equal((await get('/api/admin/push/tokens', memberToken)).json().total, 0);
  ticketFor = () => ({ status: 'ok', id: 'ticket' });
  assert.equal((await get('/health')).json().push.lastError, 'DeviceNotRegistered');
});

test('store purchase: webhook retries and the app sync never activate twice; the member gets a push', async () => {
  const me = await get('/api/me', unactivatedToken);
  const contactId = me.json().me.id as number;
  await post('/api/push/tokens', { token: GUEST_TOKEN, platform: 'android' }, unactivatedToken);
  const now = Date.now();
  const expires = now + 365 * 86_400_000;
  const event = (id: string, type: string, transaction: string) => ({
    api_version: '1.0',
    event: { id, type, app_user_id: `vc-${contactId}`, product_id: 'club_membership_annual', store: 'PLAY_STORE', environment: 'SANDBOX', purchased_at_ms: now, expiration_at_ms: expires, transaction_id: transaction },
  });
  const auth = { authorization: 'Bearer test-webhook-secret-123' };
  const first = await post('/api/webhooks/revenuecat', event('ev-b1', 'INITIAL_PURCHASE', 'GPA.1'), undefined, auth);
  assert.equal(first.json().activation, 'activated', first.body);
  await built.push.idle();
  assert.equal(lastPush().to, GUEST_TOKEN);
  assert.equal(lastPush().title, 'تم تفعيل عضويتك السنوية');
  assert.deepEqual(lastPush().data, { type: 'membership', status: 'active', screen: '/membership' });
  const pushes = pushBatches.length;

  const retry = await post('/api/webhooks/revenuecat', event('ev-b1', 'INITIAL_PURCHASE', 'GPA.1'), undefined, auth);
  assert.equal(retry.json().activation, 'activated');
  const sameExpiry = await post('/api/webhooks/revenuecat', event('ev-b2', 'RENEWAL', 'GPA.2'), undefined, auth);
  assert.equal(sameExpiry.json().activation, 'duplicate', sameExpiry.body);
  const sameTransaction = await post('/api/webhooks/revenuecat', { ...event('ev-b3', 'INITIAL_PURCHASE', 'GPA.1'), event: { ...event('ev-b3', 'INITIAL_PURCHASE', 'GPA.1').event, expiration_at_ms: expires + 1 } }, undefined, auth);
  assert.equal(sameTransaction.json().activation, 'duplicate');
  await built.push.idle();
  assert.equal(pushBatches.length, pushes);
  assert.equal((await get('/api/me', unactivatedToken)).json().me.membership.status, 'active');

  // The app's sync: REST check activates when the webhook has not, once.
  const before = await get('/api/me', syncToken);
  assert.equal(before.json().me.membership.status, 'unactivated');
  subscriber = null;
  const down = await post('/api/membership/sync', {}, syncToken);
  assert.equal(down.statusCode, 502, down.body);
  subscriber = {
    entitlements: { membership: { expires_date: new Date(expires).toISOString(), purchase_date: new Date(now).toISOString(), product_identifier: 'club_membership_annual' } },
    subscriptions: { 'club_membership_annual:annual': { store: 'play_store', is_sandbox: true, store_transaction_id: 'GPA.777' } },
  };
  const synced = await post('/api/membership/sync', {}, syncToken);
  assert.equal(synced.statusCode, 200, synced.body);
  assert.deepEqual([synced.json().checked, synced.json().entitlementActive, synced.json().activation], [true, true, 'activated']);
  assert.equal(synced.json().me.membership.status, 'active');
  const again = await post('/api/membership/sync', {}, syncToken);
  assert.equal(again.json().activation, 'activated');
  const list = await get('/api/admin/membership/purchases', memberToken);
  const syncEvents = (list.json().events as { type: string; store: string; transactionId: string }[]).filter((entry) => entry.type === 'SYNC');
  assert.equal(syncEvents.length, 1);
  assert.deepEqual([syncEvents[0]?.store, syncEvents[0]?.transactionId], ['PLAY_STORE', 'GPA.777']);
  assert.ok(mailer.sent.some((mail) => mail.subject.includes('تفعيل عضوية سنوية من المتجر')));

  subscriber = { entitlements: {} };
  const none = await post('/api/membership/sync', {}, unactivatedToken);
  assert.deepEqual([none.json().entitlementActive, none.json().activation], [false, 'none']);
});
