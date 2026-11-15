import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signData, type KeyObject } from 'node:crypto';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

/**
 * M241: an account born from Google / Apple has no password its owner knows, so the deletion steps take a fresh
 * provider token of the SAME account instead. The tokens are real RS256 JWTs signed with a test key and the verifier
 * reads "Google's" and "Apple's" keys from the injected fetch, exactly as in m46.social.test.ts.
 */
const GOOGLE_AUD = 'test-client.apps.googleusercontent.com';
const APPLE_AUD = 'com.vibesholding.club';
const KID = 'm241-test-key';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: KID, alg: 'RS256', use: 'sig' };

const b64u = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

function signToken(payload: Record<string, unknown>, key: KeyObject = privateKey): string {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const signature = signData('RSA-SHA256', Buffer.from(`${head}.${body}`), key);
  return `${head}.${body}.${signature.toString('base64url')}`;
}

const now = (): number => Math.floor(Date.now() / 1000);

function googleToken(email: string, extra: Record<string, unknown> = {}, key: KeyObject = privateKey): string {
  return signToken({ iss: 'https://accounts.google.com', aud: GOOGLE_AUD, sub: `g-${email}`, email, email_verified: true, name: 'سارة القحطاني', exp: now() + 600, iat: now(), ...extra }, key);
}

function appleToken(email: string, extra: Record<string, unknown> = {}): string {
  return signToken({ iss: 'https://appleid.apple.com', aud: APPLE_AUD, sub: `a-${email}`, email, email_verified: 'true', exp: now() + 600, iat: now(), ...extra });
}

/** Serves the test keys for both providers; nothing else may be fetched in these tests. */
const fetchImpl: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes('googleapis.com/oauth2/v3/certs') || url.includes('appleid.apple.com/auth/keys')) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
};

const config = loadConfig({
  LOG_LEVEL: 'silent',
  HUB_MODE: 'mock',
  NEWS_REFRESH_MINUTES: '0',
  VIDEOS_REFRESH_MINUTES: '0',
  NOTIFY_EMAIL: 'admin@vcmem.com',
  GOOGLE_CLIENT_IDS: GOOGLE_AUD,
  APPLE_APP_IDS: APPLE_AUD,
});
const hub = new MockHubClient();
const accountsAtHub = (): number => (hub as unknown as { state: { contacts: Map<number, unknown> } }).state.contacts.size;

let built: BuiltApp;
let app: BuiltApp['app'];

// Every request comes from its own address, so the per-address limits never mix the cases up.
let caller = 0;
const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>, token?: string, ip?: string) => {
  caller += 1;
  return app.inject({ method, url, ...(payload ? { payload } : {}), remoteAddress: ip ?? `10.41.${Math.floor(caller / 250)}.${(caller % 250) + 1}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
};
const scheduledOf = async (token: string) => (await call('GET', '/api/me/delete/state', undefined, token)).json().scheduled as { daysLeft: number } | null;

async function socialSignUp(provider: 'google' | 'apple', email: string, name: string): Promise<string> {
  const token = provider === 'google' ? googleToken(email, { name }) : appleToken(email);
  const signed = await call('POST', '/api/auth/social', { provider, token, name });
  assert.equal(signed.statusCode, 200, signed.body);
  assert.equal(signed.json().created, true, 'the account is born from the provider, with no password its owner knows');
  return signed.json().token as string;
}

async function passwordSignUp(email: string, phone: string, name: string): Promise<string> {
  const registered = await call('POST', '/api/auth/register', { name, country: 'sa', phone, email, password: 'secret123', persona: 'neutral', bio: 'حساب لاختبار حذف الحساب بكلمة المرور.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await call('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return verified.json().token as string;
}

let googleBorn = '';
let appleBorn = '';
let otherGoogle = '';
let passwordBorn = '';

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer: new LogMailer(), fetchImpl });
  app = built.app;
  googleBorn = await socialSignUp('google', 'sara.alqahtani@gmail.com', 'سارة القحطاني');
  appleBorn = await socialSignUp('apple', 'fahad.aldosari@icloud.com', 'فهد الدوسري');
  otherGoogle = await socialSignUp('google', 'noura.alshehri@gmail.com', 'نورة الشهري');
  passwordBorn = await passwordSignUp('khalid.alharbi@gmail.com', '0558624101', 'خالد الحربي');
});

after(async () => {
  await app.close();
});

test('a body with neither a password nor a provider proof is refused on both routes', async () => {
  const start = await call('POST', '/api/me/delete/start', { reason: 'اختبار' }, googleBorn);
  assert.equal(start.statusCode, 400, start.body);
  assert.equal(start.json().error.code, 'invalid');
  const legacy = await call('DELETE', '/api/me', { reason: 'اختبار' }, googleBorn);
  assert.equal(legacy.statusCode, 400, legacy.body);
  assert.equal(legacy.json().error.code, 'invalid');
  // A proof without its token is no proof either.
  const hollow = await call('POST', '/api/me/delete/start', { social: { provider: 'google' } }, googleBorn);
  assert.equal(hollow.statusCode, 400, hollow.body);
  assert.equal(await scheduledOf(googleBorn), null);
});

test('a token of a different account is refused', async () => {
  const foreign = await call('POST', '/api/me/delete/start', { social: { provider: 'google', token: googleToken('noura.alshehri@gmail.com') } }, googleBorn);
  assert.equal(foreign.statusCode, 403, foreign.body);
  assert.equal(foreign.json().error.code, 'social_mismatch');
  assert.match(foreign.json().error.message, /[؀-ۿ]/);
  // The same identity under the other provider's name is still somebody else.
  const crossed = await call('DELETE', '/api/me', { social: { provider: 'apple', token: appleToken('noura.alshehri@gmail.com') } }, googleBorn);
  assert.equal(crossed.statusCode, 403, crossed.body);
  assert.equal(crossed.json().error.code, 'social_mismatch');
  // Neither the caller nor the account the token belongs to is scheduled.
  assert.equal(await scheduledOf(googleBorn), null);
  assert.equal(await scheduledOf(otherGoogle), null);
});

test('a token of an identity with no account is refused and never creates one', async () => {
  const before = accountsAtHub();
  const stranger = await call('POST', '/api/me/delete/start', { social: { provider: 'google', token: googleToken('stranger.person@gmail.com') } }, googleBorn);
  assert.equal(stranger.statusCode, 403, stranger.body);
  assert.equal(stranger.json().error.code, 'social_mismatch');
  assert.equal(accountsAtHub(), before, 'the deletion path never registers anybody');
  assert.equal(await scheduledOf(googleBorn), null);
});

test('an invalid or expired token is refused without ending the session', async () => {
  const own = 'sara.alqahtani@gmail.com';
  const foreignKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const refused: [string, string][] = [
    ['expired', googleToken(own, { exp: now() - 3600 })],
    ['another audience', googleToken(own, { aud: 'evil-client' })],
    ['another issuer', googleToken(own, { iss: 'https://accounts.example.com' })],
    ['forged signature', googleToken(own, {}, foreignKey)],
    ['not a token at all', 'this-is-not-a-provider-token-at-all'],
  ];
  for (const [label, token] of refused) {
    const res = await call('POST', '/api/me/delete/start', { social: { provider: 'google', token } }, googleBorn);
    // 403, never 401: the app signs the member out on a 401 that carries the session token.
    assert.equal(res.statusCode, 403, `${label}: ${res.body}`);
    assert.equal(res.json().error.code, 'social_token', label);
  }
  // A real Google token offered as an Apple one fails Apple's issuer check.
  const wrongProvider = await call('POST', '/api/me/delete/start', { social: { provider: 'apple', token: googleToken(own) } }, googleBorn);
  assert.equal(wrongProvider.statusCode, 403, wrongProvider.body);
  assert.equal(wrongProvider.json().error.code, 'social_token');
  // An e-mail the provider does not vouch for maps to no account, exactly as at sign-in.
  const unverified = await call('POST', '/api/me/delete/start', { social: { provider: 'google', token: googleToken(own, { email_verified: false }) } }, googleBorn);
  assert.equal(unverified.statusCode, 403, unverified.body);
  assert.equal(unverified.json().error.code, 'social_mismatch');

  assert.equal((await call('GET', '/api/me', undefined, googleBorn)).statusCode, 200, 'the session lives on');
  assert.equal(await scheduledOf(googleBorn), null);
});

test('a google-born account schedules its deletion with a fresh token of its own identity', async () => {
  // The dead end this milestone removes: the account has no password its owner could type.
  const guess = await call('POST', '/api/me/delete/start', { password: 'secret123' }, googleBorn);
  assert.equal(guess.statusCode, 403, guess.body);
  assert.equal(guess.json().error.code, 'bad_password');
  // A typed password is judged alone, the way it always was — a proof beside it does not rescue a wrong one.
  const both = await call('POST', '/api/me/delete/start', { password: 'not-the-one', social: { provider: 'google', token: googleToken('sara.alqahtani@gmail.com') } }, googleBorn);
  assert.equal(both.statusCode, 403, both.body);
  assert.equal(both.json().error.code, 'bad_password');

  const accounts = accountsAtHub();
  // The app sends the very object it sends to /api/auth/social (the name rides along and is ignored).
  const started = await call('POST', '/api/me/delete/start', { social: { provider: 'google', token: googleToken('Sara.AlQahtani@Gmail.com'), name: 'سارة القحطاني' }, reason: 'اختبار' }, googleBorn);
  assert.equal(started.statusCode, 200, started.body);
  assert.equal(started.json().days, 30);
  const word = started.json().word as string;
  assert.ok(word.length >= 3, 'the confirm word is handed to the app');

  const confirmed = await call('POST', '/api/me/delete/confirm', { code: MOCK_CODE, word }, googleBorn);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().daysLeft, 30);
  assert.equal((await scheduledOf(googleBorn))?.daysLeft, 30);
  assert.equal(accountsAtHub(), accounts, 'proving the account creates nothing at the hub');
  // The account still works through the grace window, and a second start is refused as before.
  assert.equal((await call('GET', '/api/me', undefined, googleBorn)).statusCode, 200);
  const again = await call('POST', '/api/me/delete/start', { social: { provider: 'google', token: googleToken('sara.alqahtani@gmail.com') } }, googleBorn);
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'already_scheduled');
});

test('an apple-born account schedules through the legacy DELETE /api/me with its apple token', async () => {
  const answer = await call('DELETE', '/api/me', { social: { provider: 'apple', token: appleToken('fahad.aldosari@icloud.com') }, reason: 'اختبار' }, appleBorn);
  assert.equal(answer.statusCode, 200, answer.body);
  assert.equal(answer.json().daysLeft, 30);
  assert.equal((await scheduledOf(appleBorn))?.daysLeft, 30);
  assert.equal((await call('GET', '/api/me', undefined, appleBorn)).statusCode, 200, 'nothing is deleted on the spot');
});

test('the password path still works on both routes', async () => {
  const wrong = await call('POST', '/api/me/delete/start', { password: 'not-the-one', reason: 'اختبار' }, passwordBorn);
  assert.equal(wrong.statusCode, 403);
  assert.equal(wrong.json().error.code, 'bad_password');
  const started = await call('POST', '/api/me/delete/start', { password: 'secret123', reason: 'اختبار' }, passwordBorn);
  assert.equal(started.statusCode, 200, started.body);
  const confirmed = await call('POST', '/api/me/delete/confirm', { code: MOCK_CODE, word: started.json().word as string }, passwordBorn);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal((await call('POST', '/api/me/delete/cancel', {}, passwordBorn)).json().cancelled, true);

  const legacyWrong = await call('DELETE', '/api/me', { password: 'nope' }, passwordBorn);
  assert.equal(legacyWrong.statusCode, 403);
  assert.equal(legacyWrong.json().error.code, 'bad_password');
  const legacy = await call('DELETE', '/api/me', { password: 'secret123', reason: 'اختبار' }, passwordBorn);
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.equal(legacy.json().daysLeft, 30);
  assert.equal((await call('POST', '/api/me/delete/cancel', {}, passwordBorn)).json().cancelled, true);
});

test('a password account may prove itself with the provider identity that signs in to it', async () => {
  // Sign-in maps a Google identity to the account that owns its verified e-mail, so the same identity proves it here.
  const started = await call('POST', '/api/me/delete/start', { social: { provider: 'google', token: googleToken('khalid.alharbi@gmail.com') } }, passwordBorn);
  assert.equal(started.statusCode, 200, started.body);
  assert.ok((started.json().word as string).length >= 3);
});

test('an empty or null password beside a provider proof leaves the proof to decide', async () => {
  // What a delete screen sends when it serialises its untouched password field next to the proof.
  const own = 'layla.alotaibi@gmail.com';
  const session = await socialSignUp('google', own, 'ليلى العتيبي');

  // The proof is still judged in full: the empty password key opens nothing by itself.
  const foreign = await call('POST', '/api/me/delete/start', { password: '', social: { provider: 'google', token: googleToken('noura.alshehri@gmail.com') } }, session);
  assert.equal(foreign.statusCode, 403, foreign.body);
  assert.equal(foreign.json().error.code, 'social_mismatch');
  const hollow = await call('POST', '/api/me/delete/start', { password: '', social: { provider: 'google' } }, session);
  assert.equal(hollow.statusCode, 400, hollow.body);
  assert.equal(hollow.json().error.code, 'invalid');
  // With no proof beside it, an empty password is still asked for, as before.
  for (const body of [{ password: '' }, { password: '', social: null }]) {
    const alone = await call('POST', '/api/me/delete/start', body, session);
    assert.equal(alone.statusCode, 400, alone.body);
    assert.equal(alone.json().error.message, 'كلمة المرور مطلوبة');
  }
  assert.equal(await scheduledOf(session), null);

  const started = await call('POST', '/api/me/delete/start', { password: '', social: { provider: 'google', token: googleToken(own) }, reason: 'اختبار' }, session);
  assert.equal(started.statusCode, 200, started.body);
  assert.ok((started.json().word as string).length >= 3);
  const legacy = await call('DELETE', '/api/me', { password: null, social: { provider: 'google', token: googleToken(own) } }, session);
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.equal(legacy.json().daysLeft, 30);
  assert.equal((await scheduledOf(session))?.daysLeft, 30);
});

test('a typed password decides alone, whatever sits in the unused social key', async () => {
  const session = await passwordSignUp('majed.alghamdi@gmail.com', '0558624102', 'ماجد الغامدي');
  // Before M241 an extra `social` key was simply ignored; beside a password it still is — it is not even read.
  const wrong = await call('DELETE', '/api/me', { password: 'not-the-one', social: null }, session);
  assert.equal(wrong.statusCode, 403, wrong.body);
  assert.equal(wrong.json().error.code, 'bad_password');
  const leftovers: unknown[] = [null, '', { provider: 'google', token: '' }];
  for (const social of leftovers) {
    const label = JSON.stringify(social);
    const right = await call('DELETE', '/api/me', { password: 'secret123', social }, session);
    assert.equal(right.statusCode, 200, `${label}: ${right.body}`);
    assert.equal(right.json().daysLeft, 30, label);
    assert.equal((await call('POST', '/api/me/delete/cancel', {}, session)).json().cancelled, true, label);
  }
  const started = await call('POST', '/api/me/delete/start', { password: 'secret123', social: null, reason: 'اختبار' }, session);
  assert.equal(started.statusCode, 200, started.body);
  assert.ok((started.json().word as string).length >= 3);
});

test('the provider proof is rate-limited like the password on both routes', async () => {
  const body = { social: { provider: 'google', token: googleToken('noura.alshehri@gmail.com', { exp: now() - 3600 }) } };
  for (const [method, url, ip] of [['POST', '/api/me/delete/start', '10.241.0.7'], ['DELETE', '/api/me', '10.241.0.8']] as const) {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const res = await call(method, url, body, otherGoogle, ip);
      assert.equal(res.statusCode, 403, `${url} attempt ${attempt}: ${res.body}`);
    }
    const blocked = await call(method, url, body, otherGoogle, ip);
    assert.equal(blocked.statusCode, 429, blocked.body);
    assert.equal(blocked.json().error.code, 'rate');
  }
  assert.equal(await scheduledOf(otherGoogle), null);
});
