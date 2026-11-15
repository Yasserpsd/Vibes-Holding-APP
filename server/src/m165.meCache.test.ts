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
/** M242: the next `account` read is answered by the hub at once but reaches the server only when released. */
let holdNextAccount: { reached: () => void; released: Promise<void> } | null = null;
hub.call = async (op, body) => {
  if (op === 'account') {
    accountCalls += 1;
    if (hubDown) throw new Error('hub down');
    if (holdNextAccount) {
      const gate = holdNextAccount;
      holdNextAccount = null;
      const answer = await original(op, body);
      gate.reached();
      await gate.released;
      return answer;
    }
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

// M242 (complaint «العضوية لا تتفعّل إلا بعد إعادة التشغيل»): a read on its way to the hub when the membership is
// activated carries the state from before it; stored with a fresh time it stood as final for a minute.
test('a read that began before the account was forgotten never puts the older copy back', async () => {
  const headers = { authorization: `Bearer ${token}` };
  const known = (await me()).json().me as { id: number; membership: { status: string } };
  assert.equal(known.membership.status, 'unactivated');
  let reached!: () => void;
  let release!: () => void;
  const atHub = new Promise<void>((resolve) => (reached = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  holdNextAccount = { reached, released };
  // A slow read begins; the hub answers it with the account as it is now (not a member).
  const slow = app.inject({ method: 'GET', url: '/api/me?fresh=1', headers });
  await atHub;
  // Meanwhile the store purchase activates the membership, and the app's sync drops the cached account.
  await original('activate_member', { contact_id: known.id, days: 365, reference: 'GPA.165', product: 'club_membership_annual', store: 'PLAY_STORE' });
  const synced = await app.inject({ method: 'POST', url: '/api/membership/sync', payload: {}, headers });
  assert.equal(synced.statusCode, 200, synced.body);
  assert.equal(synced.json().me.membership.status, 'active');
  // The slow read lands now, with the copy from before the activation.
  release();
  assert.equal((await slow).statusCode, 200);
  assert.equal((await me()).json().me.membership.status, 'active', 'the cache keeps the copy read after the activation');
});

// M242: the sync used to fail with the hub; the app then never got an answer in that try.
test('the membership sync answers the earlier account when the hub cannot be re-read', async () => {
  const headers = { authorization: `Bearer ${token}` };
  const known = (await me()).json().me as { id: number };
  hubDown = true;
  const synced = await app.inject({ method: 'POST', url: '/api/membership/sync', payload: {}, headers });
  assert.equal(synced.statusCode, 200, synced.body);
  assert.deepEqual([synced.json().checked, synced.json().activation, synced.json().me.id], [false, 'none', known.id]);
  // The earlier copy was dropped by that sync: with nothing to fall back on, the failure stands.
  const again = await app.inject({ method: 'POST', url: '/api/membership/sync', payload: {}, headers });
  assert.ok(again.statusCode >= 500, again.body);
  hubDown = false;
  assert.equal((await me()).statusCode, 200);

  // A copy older than a day is no fallback either: `me()` itself never answers one without asking the hub.
  mock.timers.tick(25 * 60 * 60_000);
  hubDown = true;
  const tooOld = await app.inject({ method: 'POST', url: '/api/membership/sync', payload: {}, headers });
  assert.ok(tooOld.statusCode >= 500, tooOld.body);
  hubDown = false;
  assert.equal((await me()).statusCode, 200);
});

test('a hub that no longer knows the account signs the member out', async () => {
  mock.timers.tick(25 * 60 * 60_000);
  hub.call = async (op, body) => (op === 'account' ? { ok: true as const, contact: null } : original(op, body));
  const gone = await me();
  assert.equal(gone.statusCode, 401);
});
