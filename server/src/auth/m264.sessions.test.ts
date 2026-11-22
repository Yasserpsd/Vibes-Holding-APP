import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { ensureMembershipSeed } from '../content/membership.js';
import { MOCK_CODE, MockHubClient } from '../hub/mock.js';
import { MemoryKV } from '../store.js';
import { cleanIp, countryOf, placeOf } from './device.js';
import { SessionStore, type SessionRecord } from './sessions.js';

/**
 * M264 «الجلسات المسجلة» (owner, 2026-11-22: «يظهر IP ومكان كل شخص فاتح الحساب»): the member sees every device signed
 * in to his account — address, country, device, last activity — and signs one of them, or all the others, out.
 */
const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];

// The server trusts its proxy (app.ts `trustProxy: true`): the forwarded address is the member's own.
const SAUDI_IP = '212.26.0.1';
const US_IP = '8.8.8.8';
const IPHONE = { 'x-forwarded-for': SAUDI_IP, 'x-app-platform': 'ios', 'x-app-binary': '1.3.5', 'x-app-version': '1.3.5' };
const ANDROID = { 'x-forwarded-for': US_IP, 'x-app-platform': 'android', 'x-app-version': '1.3.4' };

type Listed = { id: string; current: boolean; platform: string | null; dashboard: boolean; appVersion: string | null; ip: string | null; country: string | null; place: string | null; signedInAt: string; lastSeenAt: string };

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, headers: Record<string, string>, token?: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
const list = async (token: string, headers: Record<string, string>): Promise<Listed[]> => {
  const res = await call('GET', '/api/me/sessions', headers, token);
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as { sessions: Listed[] }).sessions;
};
const keyOf = (token: string): string => `session:${createHash('sha256').update(token).digest('hex')}`;
const works = async (token: string): Promise<boolean> => (await call('GET', '/api/me', {}, token)).statusCode === 200;

const member = { name: 'سالم الجلسات', country: 'sa', phone: '0558318701', email: 'salem.sessions@gmail.com', password: 'secret123', persona: 'investor' };
const other = { name: 'ماجد الآخر', country: 'sa', phone: '0558318702', email: 'majed.other@gmail.com', password: 'secret123', persona: 'investor' };

async function signUp(account: typeof member, headers: Record<string, string>): Promise<string> {
  const registered = await call('POST', '/api/auth/register', headers, undefined, account);
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await call('POST', '/api/auth/verify', headers, undefined, { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return verified.json().token as string;
}
async function signIn(account: typeof member, headers: Record<string, string>): Promise<string> {
  const res = await call('POST', '/api/auth/login', headers, undefined, { login: account.email, password: account.password });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().token as string;
}

let iphone = '';
let android = '';
let stranger = '';

before(async () => {
  await ensureMembershipSeed(kv);
  app = (await buildApp({ config, kv, hub: new MockHubClient() })).app;
  iphone = await signUp(member, IPHONE);
  android = await signIn(member, ANDROID);
  stranger = await signUp(other, { 'x-forwarded-for': '41.32.0.1', 'x-app-platform': 'android' });
});

after(async () => {
  await app.close();
});

test('m264: the sign-in screen is told the server lists devices', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/config' });
  assert.equal(res.json().deviceSessions, true);
});

test('m264: the offline table names the country of an address and knows nothing about a private one', () => {
  assert.equal(countryOf(SAUDI_IP), 'SA');
  assert.equal(countryOf(`::ffff:${SAUDI_IP}`), 'SA');
  assert.equal(countryOf('2a02:cb80::1'), 'SA');
  assert.deepEqual(placeOf(SAUDI_IP, 'ar'), { country: 'SA', place: 'السعودية' });
  assert.deepEqual(placeOf(SAUDI_IP, 'en'), { country: 'SA', place: 'Saudi Arabia' });
  for (const ip of ['10.0.0.7', '127.0.0.1', '192.168.1.5', '', 'not-an-address']) assert.deepEqual(placeOf(ip, 'ar'), { country: null, place: null }, ip);
  assert.equal(cleanIp('<script>'), '');
});

test('m264: sign-up and password sign-in both record the address, the platform and the app version', async () => {
  const first = await kv.get<SessionRecord>(keyOf(iphone));
  assert.equal(first?.ip, SAUDI_IP, 'the sign-up recorded where it came from');
  assert.equal(first?.platform, 'ios');
  assert.equal(first?.appVersion, '1.3.5');
  const second = await kv.get<SessionRecord>(keyOf(android));
  assert.equal(second?.ip, US_IP, 'the password sign-in recorded where it came from');
  assert.equal(second?.platform, 'android');
  assert.equal(second?.appVersion, '1.3.4');
  assert.match(first?.sid ?? '', /^[A-Za-z0-9_-]{16}$/);
  assert.notEqual(first?.sid, second?.sid);
});

test('m264: the list is the member\'s own devices only, marks this one, and never carries a token', async () => {
  const res = await call('GET', '/api/me/sessions', IPHONE, iphone);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers['cache-control'], 'no-store');
  const sessions = (res.json() as { sessions: Listed[] }).sessions;
  assert.equal(sessions.length, 2, 'two devices of this account, none of the other member');
  assert.deepEqual(sessions.map((item) => item.current), [true, false], 'this device leads and is the only one marked');

  const [mine, phone2] = sessions as [Listed, Listed];
  assert.deepEqual({ platform: mine.platform, appVersion: mine.appVersion, ip: mine.ip, country: mine.country, place: mine.place }, { platform: 'ios', appVersion: '1.3.5', ip: SAUDI_IP, country: 'SA', place: 'السعودية' });
  assert.deepEqual({ platform: phone2.platform, appVersion: phone2.appVersion, ip: phone2.ip, country: phone2.country, dashboard: phone2.dashboard }, { platform: 'android', appVersion: '1.3.4', ip: US_IP, country: 'US', dashboard: false });
  assert.ok(Date.parse(mine.lastSeenAt) >= Date.parse(mine.signedInAt));

  // Nothing that opens a session, and nothing the hub knows the device by.
  const text = res.body;
  for (const secret of [iphone, android, keyOf(iphone).slice(8), keyOf(android).slice(8)]) assert.ok(!text.includes(secret), 'no token and no token hash');
  for (const record of [await kv.get<SessionRecord>(keyOf(iphone)), await kv.get<SessionRecord>(keyOf(android))]) assert.ok(record && !text.includes(record.uuid), 'no hub visitor id');
  assert.deepEqual(Object.keys(mine).sort(), ['appVersion', 'country', 'current', 'dashboard', 'id', 'ip', 'lastSeenAt', 'place', 'platform', 'signedInAt']);

  // The English app reads the place in English; a guest reads nothing.
  assert.equal((await list(iphone, { ...IPHONE, 'x-app-lang': 'en' }))[0]?.place, 'Saudi Arabia');
  assert.equal((await call('GET', '/api/me/sessions', IPHONE)).statusCode, 401);

  // The other member sees his own single device.
  const theirs = await list(stranger, {});
  assert.equal(theirs.length, 1);
  assert.equal(theirs[0]?.current, true);
});

test('m264: a device that moves to another network shows its latest address', async () => {
  const moved = await list(android, { ...ANDROID, 'x-forwarded-for': '41.32.0.9' });
  assert.equal(moved[0]?.ip, '41.32.0.9');
  assert.equal(moved[0]?.country, 'EG');
  assert.equal((await kv.get<SessionRecord>(keyOf(android)))?.ip, US_IP, 'where it signed in stays on record');
  // A request of a phone's session without the app's header (a web view) does not turn it into a browser.
  assert.equal((await list(android, { 'x-forwarded-for': US_IP }))[0]?.platform, 'android');
});

test('m264: signing one device out ends its token only; another member\'s device cannot be touched', async () => {
  const third = await signIn(member, { 'x-forwarded-for': '10.0.0.9', 'x-app-platform': 'android' });
  const before = await list(iphone, IPHONE);
  assert.equal(before.length, 3);
  const target = before.find((item) => item.ip === '10.0.0.9');
  assert.ok(target, 'the third device is listed');
  assert.equal(target.place, null, 'a private address has no place');

  const strangerId = (await list(stranger, {}))[0]?.id ?? '';
  const foreign = await call('DELETE', `/api/me/sessions/${strangerId}`, IPHONE, iphone);
  assert.equal(foreign.statusCode, 404, 'another account\'s device is not mine to end');
  assert.equal(await works(stranger), true);

  const own = await call('DELETE', `/api/me/sessions/${before[0]?.id ?? ''}`, IPHONE, iphone);
  assert.equal(own.statusCode, 400, 'this device leaves through the sign-out itself');
  assert.equal(own.json().error.code, 'current_session');

  const ended = await call('DELETE', `/api/me/sessions/${target.id}`, IPHONE, iphone);
  assert.equal(ended.statusCode, 200, ended.body);
  assert.equal(await works(third), false, 'its token stopped working');
  assert.equal(await works(iphone), true);
  assert.equal(await works(android), true);
  assert.equal((await list(iphone, IPHONE)).length, 2);
  assert.equal((await call('DELETE', `/api/me/sessions/${target.id}`, IPHONE, iphone)).statusCode, 404, 'already gone');
});

test('m264: a session stored before M264 keeps working, then shows in the list with what its request says', async () => {
  const account = await kv.get<SessionRecord>(keyOf(iphone));
  assert.ok(account);
  const oldToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  // Exactly what the store wrote before M264: no public id, no address, no device.
  const legacy: SessionRecord = { uuid: 'app-legacy-device', contactId: account.contactId, createdAt: new Date(now - 5 * 86_400_000).toISOString(), expiresAt: new Date(now + 20 * 86_400_000).toISOString(), lastSeenAt: new Date(now - 3 * 3_600_000).toISOString() };
  await kv.set(keyOf(oldToken), legacy);

  assert.equal((await list(iphone, IPHONE)).length, 2, 'not listed before its first request');
  const own = await list(oldToken, { 'x-forwarded-for': SAUDI_IP, 'x-app-platform': 'ios' });
  assert.equal(own.length, 3, 'its own request works and puts it in the list');
  assert.equal(own[0]?.current, true);
  assert.deepEqual({ ip: own[0]?.ip, platform: own[0]?.platform, appVersion: own[0]?.appVersion }, { ip: SAUDI_IP, platform: 'ios', appVersion: null });
  assert.equal((await kv.get<SessionRecord>(keyOf(oldToken)))?.ip, undefined, 'where it signed in is not known and not invented');

  // One that never says anything about itself (no forwarded address, no header) is listed with nothing known.
  const silent = randomBytes(32).toString('base64url');
  await kv.set(keyOf(silent), { ...legacy, uuid: 'app-legacy-silent' });
  const record = await new SessionStore(kv, 30).getSession(silent);
  assert.match(record?.sid ?? '', /^[A-Za-z0-9_-]{16}$/);
  const quiet = (await list(iphone, IPHONE)).find((item) => item.id === record?.sid);
  assert.deepEqual({ ip: quiet?.ip, place: quiet?.place, platform: quiet?.platform }, { ip: null, place: null, platform: null });
});

test('m264: signing all the others out keeps this device only — even an old session that was never listed', async () => {
  const account = await kv.get<SessionRecord>(keyOf(iphone));
  assert.ok(account);
  const unlisted = randomBytes(32).toString('base64url');
  const now = Date.now();
  await kv.set(keyOf(unlisted), { uuid: 'app-legacy-unlisted', contactId: account.contactId, createdAt: new Date(now - 86_400_000).toISOString(), expiresAt: new Date(now + 20 * 86_400_000).toISOString(), lastSeenAt: new Date(now - 86_400_000).toISOString() });

  assert.ok((await list(iphone, IPHONE)).length >= 3);
  const res = await call('POST', '/api/me/sessions/sign-out-others', IPHONE, iphone);
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(res.json().ended >= 2);

  assert.equal(await works(iphone), true, 'the device that asked stays');
  assert.equal(await works(android), false);
  assert.equal(await works(unlisted), false, 'a session from before the list is refused when it comes back');
  assert.equal(await works(stranger), true, 'the other member is untouched');
  const left = await list(iphone, IPHONE);
  assert.equal(left.length, 1);
  assert.equal(left[0]?.current, true);

  // A sign-in after the press is a new device like any other.
  const fresh = await signIn(member, ANDROID);
  assert.equal(await works(fresh), true);
  assert.equal((await list(iphone, IPHONE)).length, 2);
});

test('m264: the ordinary sign-out removes the device from the list', async () => {
  const extra = await signIn(member, ANDROID);
  const count = (await list(iphone, IPHONE)).length;
  assert.equal((await call('POST', '/api/auth/logout', ANDROID, extra, {})).statusCode, 200);
  assert.equal((await list(iphone, IPHONE)).length, count - 1);
});
