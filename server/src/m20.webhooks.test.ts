import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { TOKENS_KEY } from './push/service.js';
import { MemoryKV } from './store.js';
import { SYNC_KEY, SyncService } from './sync/service.js';
import { checkSignature, sign } from './webhooks/signature.js';

// Test-only values; the real ones live in the environment (rule 1).
const HUB_SECRET = 'test-hub-webhook-secret-000001';
const PB_KEY = 'test-pb-bridge-key-0000000000001';

class CountingHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly ops: HubOp[] = [];
  private readonly inner = new MockHubClient({ seed: true });

  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    this.ops.push(op);
    return this.inner.call(op, body);
  }

  count(op: HubOp): number {
    return this.ops.filter((entry) => entry === op).length;
  }
}

const pushed: { to: string; title: string; data: Record<string, string> }[] = [];
const fetchStub: typeof fetch = async (input, init) => {
  if (String(input).includes('exp.host')) {
    const messages = JSON.parse(String(init?.body)) as { to: string; title: string; data: Record<string, string> }[];
    pushed.push(...messages);
    return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
};

/** Storage that can lose one key for a while, as Postgres does when its connection drops. */
class BreakableKV extends MemoryKV {
  readonly broken = new Set<string>();
  reads = 0;

  override async get<T>(key: string): Promise<T | null> {
    this.reads += 1;
    if (this.broken.has(key)) throw new Error('connection terminated');
    return super.get<T>(key);
  }
}

const hub = new CountingHub();
const kv = new BreakableKV();
// PB_BRIDGE_KEY makes the bridge live: here it only reaches the fetch stub, and the key signs the plugin's webhook.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', HUB_WEBHOOK_SECRET: HUB_SECRET, PB_BRIDGE_KEY: PB_KEY });
let built: Awaited<ReturnType<typeof buildApp>>;
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let token = '';
let contactId = 0;
let unique = 0;

/** A signed webhook as the plugins send it: the signature covers `timestamp.raw_body`. */
function hook(url: string, secret: string, event: string, data: Record<string, unknown>, options: { at?: number; prefix?: string; signature?: string; body?: string } = {}) {
  unique += 1;
  const body = options.body ?? JSON.stringify({ event, at: new Date().toISOString(), data: { ...data, n: unique } });
  const timestamp = String(Math.floor((options.at ?? Date.now()) / 1000));
  const prefix = options.prefix ?? 'x-vai';
  return app.inject({ method: 'POST', url, payload: body, headers: { 'content-type': 'application/json', [`${prefix}-timestamp`]: timestamp, [`${prefix}-signature`]: options.signature ?? sign(secret, timestamp, body) } });
}
const versions = async () => (await app.inject({ method: 'GET', url: '/api/sync' })).json().v as Record<string, number>;
const auth = () => ({ authorization: `Bearer ${token}` });

before(async () => {
  built = await buildApp({ config, kv, hub, fetchImpl: fetchStub });
  app = built.app;
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'عضو الإشعارات', country: 'sa', phone: '0558318721', email: 'm20.hooks+member@gmail.com', password: 'secret123', persona: 'investor', bio: 'حساب لاختبار المزامنة الفورية.' } });
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  assert.equal(verified.statusCode, 200, verified.body);
  token = verified.json().token as string;
  contactId = verified.json().me.id as number;
});

after(async () => {
  await app.close();
});

test('checkSignature: right, wrong, missing and out of the five-minute window', () => {
  const now = Date.UTC(2026, 8, 20, 12, 0, 0);
  const timestamp = String(now / 1000);
  const signature = sign('secret-one-secret-one', timestamp, '{"a":1}');
  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  assert.equal(checkSignature({ secret: 'secret-one-secret-one', timestamp, signature, rawBody: '{"a":1}', now }), 'ok');
  assert.equal(checkSignature({ secret: 'secret-one-secret-one', timestamp, signature: signature.toUpperCase().replace('SHA256', 'sha256'), rawBody: '{"a":1}', now }), 'ok');
  assert.equal(checkSignature({ secret: 'secret-two-secret-two', timestamp, signature, rawBody: '{"a":1}', now }), 'bad');
  assert.equal(checkSignature({ secret: 'secret-one-secret-one', timestamp, signature, rawBody: '{"a":2}', now }), 'bad');
  assert.equal(checkSignature({ secret: 'secret-one-secret-one', timestamp, signature: 'sha256=00', rawBody: '{"a":1}', now }), 'bad');
  assert.equal(checkSignature({ secret: 'secret-one-secret-one', timestamp, signature: `${signature}00`, rawBody: '{"a":1}', now }), 'bad');
  assert.equal(checkSignature({ secret: 'secret-one-secret-one', timestamp: undefined, signature, rawBody: '{"a":1}', now }), 'missing');
  assert.equal(checkSignature({ secret: 'secret-one-secret-one', timestamp, signature: undefined, rawBody: '{"a":1}', now }), 'missing');
  assert.equal(checkSignature({ secret: 'secret-one-secret-one', timestamp, signature, rawBody: '{"a":1}', now: now + 299_000 }), 'ok');
  assert.equal(checkSignature({ secret: 'secret-one-secret-one', timestamp, signature, rawBody: '{"a":1}', now: now + 301_000 }), 'stale');
  assert.equal(checkSignature({ secret: 'secret-one-secret-one', timestamp, signature, rawBody: '{"a":1}', now: now - 301_000 }), 'stale');
});

test('hub webhook: a good signature is accepted once; bad, unsigned and stale requests change nothing', async () => {
  const start = await versions();
  const unsigned = await app.inject({ method: 'POST', url: '/api/webhooks/hub', payload: { event: 'knowledge.changed', data: {} } });
  assert.deepEqual([unsigned.statusCode, unsigned.json().error.code], [401, 'bad_signature']);
  assert.equal(unsigned.headers['cache-control'], 'no-store');
  const forged = await hook('/api/webhooks/hub', 'another-secret-another-secret', 'knowledge.changed', { count: 1 });
  assert.deepEqual([forged.statusCode, forged.json().error.code], [401, 'bad_signature']);
  const stale = await hook('/api/webhooks/hub', HUB_SECRET, 'knowledge.changed', { count: 1 }, { at: Date.now() - 301_000 });
  assert.deepEqual([stale.statusCode, stale.json().error.code], [401, 'stale']);
  const future = await hook('/api/webhooks/hub', HUB_SECRET, 'knowledge.changed', { count: 1 }, { at: Date.now() + 400_000 });
  assert.equal(future.statusCode, 401);
  assert.deepEqual(await versions(), start, 'nothing moved');

  const body = JSON.stringify({ event: 'knowledge.changed', at: '2026-09-20 10:00:00', data: { site: 'نادي المستثمرين', host: 'vcmem.com', count: 2, cursor: 99 } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = { 'content-type': 'application/json; charset=utf-8', 'x-vai-timestamp': timestamp, 'x-vai-signature': sign(HUB_SECRET, timestamp, body) };
  const good = await app.inject({ method: 'POST', url: '/api/webhooks/hub', payload: body, headers });
  assert.deepEqual([good.statusCode, good.json()], [200, { ok: true }]);
  const moved = await versions();
  assert.ok((moved.feed ?? 0) > (start.feed ?? 0));
  assert.deepEqual([moved.posts, moved.projects, moved.content], [start.posts, start.projects, start.content]);

  // The very same signed request again (a replay inside the window) is answered and ignored.
  const replay = await app.inject({ method: 'POST', url: '/api/webhooks/hub', payload: body, headers });
  assert.deepEqual([replay.statusCode, replay.json().duplicate], [200, true]);
  assert.deepEqual(await versions(), moved);
  // A right signature over another body does not pass.
  const tampered = await app.inject({ method: 'POST', url: '/api/webhooks/hub', payload: body.replace('"count":2', '"count":3'), headers });
  assert.equal(tampered.statusCode, 401);

  const unknown = await hook('/api/webhooks/hub', HUB_SECRET, 'something.else', {});
  assert.deepEqual([unknown.statusCode, unknown.json().ignored], [200, true]);
  const broken = await hook('/api/webhooks/hub', HUB_SECRET, '', {}, { body: '{"no":"event"}' });
  assert.equal(broken.statusCode, 400);
});

test('hub events: config moves the content version, member and payment changes drop the dashboard cache', async () => {
  const start = await versions();
  assert.equal((await hook('/api/webhooks/hub', HUB_SECRET, 'config.changed', { rev: 7 })).statusCode, 200);
  assert.ok(((await versions()).content ?? 0) > (start.content ?? 0));

  await app.inject({ method: 'GET', url: '/api/admin/home', headers: auth() });
  await app.inject({ method: 'GET', url: '/api/admin/home', headers: auth() });
  assert.equal(hub.count('admin_stats'), 1, 'cached');
  assert.equal((await hook('/api/webhooks/hub', HUB_SECRET, 'member.changed', { contact_id: contactId, kind: 'renewed' })).statusCode, 200);
  await app.inject({ method: 'GET', url: '/api/admin/home', headers: auth() });
  assert.equal(hub.count('admin_stats'), 2, 'asked again after the webhook');
  assert.equal((await hook('/api/webhooks/hub', HUB_SECRET, 'payment.recorded', { id: 5, action: 'membership', success: 1 })).statusCode, 200);
  await app.inject({ method: 'GET', url: '/api/admin/home', headers: auth() });
  assert.equal(hub.count('admin_stats'), 3);
});

test('message.staff pushes a notification to that member, without the words of the reply', async () => {
  const registered = await app.inject({ method: 'POST', url: '/api/push/tokens', headers: auth(), payload: { token: 'ExponentPushToken[m20hooksdevice000001]', platform: 'android' } });
  assert.equal(registered.statusCode, 200, registered.body);
  assert.equal((await hook('/api/webhooks/hub', HUB_SECRET, 'message.assistant', { contact_id: contactId, message_id: 10 })).statusCode, 200);
  await built.push.idle();
  assert.equal(pushed.length, 0, 'the assistant answers are polled, not pushed');
  assert.equal((await hook('/api/webhooks/hub', HUB_SECRET, 'message.staff', { contact_id: contactId, message_id: 11 })).statusCode, 200);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await built.push.idle();
  assert.equal(pushed.length, 1);
  assert.deepEqual([pushed[0]?.to, pushed[0]?.title, pushed[0]?.data.screen], ['ExponentPushToken[m20hooksdevice000001]', 'رد من فريق النادي', '/advisor']);
});

test('message.staff while storage is down: the webhook still answers and the failed push is only logged', async () => {
  const before = pushed.length;
  kv.broken.add(TOKENS_KEY);
  try {
    const res = await hook('/api/webhooks/hub', HUB_SECRET, 'message.staff', { contact_id: contactId, message_id: 12 });
    assert.deepEqual([res.statusCode, res.json()], [200, { ok: true }]);
    // An unhandled rejection here would end the process (and this test run with it).
    await built.push.idle();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(pushed.length, before);
  } finally {
    kv.broken.delete(TOKENS_KEY);
  }
});

test('/api/sync is served from memory: kv is read once, a bump moves the copy and is saved', async () => {
  const store = new BreakableKV();
  await store.set(SYNC_KEY, { posts: 5, feed: 'x' });
  const sync = new SyncService(store);
  assert.deepEqual(await sync.versions(), { posts: 5, projects: 0, news: 0, content: 0, feed: 0 });
  for (let index = 0; index < 50; index += 1) await sync.versions();
  assert.equal(store.reads, 1);
  await Promise.all([sync.bump('posts'), sync.bump('posts', 'feed')]);
  const moved = await sync.versions();
  assert.ok(moved.posts > 5 && moved.feed > 0 && moved.projects === 0);
  assert.deepEqual(await store.get(SYNC_KEY), moved);
  assert.equal(store.reads, 2, 'only this test read kv again');
  // A caller cannot change the copy in memory.
  (await sync.versions()).posts = 1;
  assert.equal((await sync.versions()).posts, moved.posts);

  // kv down at the first read: the failure is not kept, the next request reads again.
  const flaky = new BreakableKV();
  flaky.broken.add(SYNC_KEY);
  const late = new SyncService(flaky);
  await assert.rejects(late.versions());
  flaky.broken.delete(SYNC_KEY);
  assert.equal((await late.versions()).posts, 0);
});

test('pb webhook: signed with the bridge key, it refreshes the snapshot and moves the projects version', async () => {
  const start = await versions();
  const wrongKey = await hook('/api/webhooks/pb', HUB_SECRET, 'project.changed', { pid: 11 });
  assert.equal(wrongKey.statusCode, 401);
  const good = await hook('/api/webhooks/pb', PB_KEY, 'project.changed', { pid: 11 });
  assert.deepEqual([good.statusCode, good.json()], [200, { ok: true }]);
  assert.ok(((await versions()).projects ?? 0) > (start.projects ?? 0));
  // The plugin's own header names work too.
  const named = await hook('/api/webhooks/pb', PB_KEY, 'project.changed', { pid: 12 }, { prefix: 'x-pb' });
  assert.equal(named.statusCode, 200);
  const other = await hook('/api/webhooks/pb', PB_KEY, 'unlock.recorded', { contact_id: 3 });
  assert.deepEqual([other.statusCode, other.json().ignored], [200, true]);
});

test('without a secret on the server the webhooks answer 503 and accept nothing', async () => {
  const bare = (await buildApp({ config: loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' }), kv: new MemoryKV(), hub: new MockHubClient() })).app;
  for (const url of ['/api/webhooks/hub', '/api/webhooks/pb']) {
    const body = JSON.stringify({ event: 'knowledge.changed', data: {} });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await bare.inject({ method: 'POST', url, payload: body, headers: { 'content-type': 'application/json', 'x-vai-timestamp': timestamp, 'x-vai-signature': sign('', timestamp, body) } });
    assert.deepEqual([res.statusCode, res.json().error.code], [503, 'not_configured'], url);
  }
  assert.equal((await bare.inject({ method: 'GET', url: '/api/sync' })).json().v.feed, 0);
  await bare.close();
});
