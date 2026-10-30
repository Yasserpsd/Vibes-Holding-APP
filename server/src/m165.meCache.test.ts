import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { MemoryKV } from './store.js';

/**
 * M165 (owner, 2026-10-31, «الأبلكيشن بطيء جدًا»): /api/me answers from its cached copy at once and asks the hub
 * behind the answer once the copy is older than a minute; only a copy older than a day waits for the hub.
 */
const config = loadConfig({ LOG_LEVEL: 'silent', NEWS_REFRESH_MINUTES: '0' });
const hub = new MockHubClient();
const original = hub.call.bind(hub);
let accountCalls = 0;
let hubDown = false;
hub.call = async (op, body) => {
  if (op === 'account') {
    accountCalls += 1;
    if (hubDown) throw new Error('hub down');
  }
  return original(op, body);
};

let app: Awaited<ReturnType<typeof buildApp>>['app'];
let token = '';
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

before(async () => {
  app = (await buildApp({ config, kv: new MemoryKV(), hub })).app;
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'سعود العتيبي', country: 'sa', phone: '0558318799', email: 'me.cache@gmail.com', password: 'secret123', persona: 'neutral', bio: 'حساب لاختبار كاش الحساب على السيرفر.' } });
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  token = verified.json().token as string;
});

after(async () => {
  mock.timers.reset();
  await app.close();
});

const me = () => app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });

test('a copy younger than a minute never reaches the hub', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  accountCalls = 0;
  const first = await me();
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().me.name, 'سعود العتيبي');
  await settle();
  assert.equal(accountCalls, 0);
});

test('an older copy is answered at once and refreshed behind the answer, even when the hub is down', async () => {
  mock.timers.tick(2 * 60_000);
  accountCalls = 0;
  hubDown = true;
  const stale = await me();
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.json().me.name, 'سعود العتيبي');
  await settle();
  assert.equal(accountCalls, 1, 'one background refresh');
  hubDown = false;
  mock.timers.tick(2 * 60_000);
  await me();
  await settle();
  assert.equal(accountCalls, 2, 'the next stale read tries the hub again');
});

test('a copy older than a day waits for the hub', async () => {
  mock.timers.tick(25 * 60 * 60_000);
  accountCalls = 0;
  const fresh = await me();
  assert.equal(fresh.statusCode, 200);
  assert.equal(accountCalls, 1);
});

test('a hub that no longer knows the account signs the member out', async () => {
  mock.timers.tick(25 * 60 * 60_000);
  hub.call = async (op, body) => (op === 'account' ? { ok: true as const, contact: null } : original(op, body));
  const gone = await me();
  assert.equal(gone.statusCode, 401);
});
