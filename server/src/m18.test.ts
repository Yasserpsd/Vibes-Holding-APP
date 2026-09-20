import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';

import { buildApp } from './app.js';
import { AdminOtpStore, maskEmail } from './auth/adminOtp.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import type { Mail, Mailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

/** Stands for a working SMTP account: the code is random and only the mail carries it. */
class CaptureMailer implements Mailer {
  readonly configured = true;
  readonly sent: Mail[] = [];
  fail = false;

  async send(mail: Mail): Promise<boolean> {
    if (this.fail) throw new Error('smtp down');
    this.sent.push(mail);
    return true;
  }

  lastCode(): string {
    const code = /\d{6}/.exec(this.sent.at(-1)?.text ?? '')?.[0];
    assert.ok(code, 'the mail carries a 6-digit code');
    return code;
  }
}

/** Remembers every stored value, to prove the code is never stored in the clear. */
class SpyKV extends MemoryKV {
  readonly written: string[] = [];

  override async set(key: string, value: unknown): Promise<void> {
    this.written.push(JSON.stringify(value));
    await super.set(key, value);
  }
}

/** The mock hub makes every verified account an admin; this wrapper can take the role away or pose as the live hub. */
class RoleHub implements HubClient {
  mode: 'live' | 'mock' = 'mock';
  demote = false;
  private readonly inner = new MockHubClient();

  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    const result = await this.inner.call(op, body);
    if (this.demote && result.contact) result.contact.is_admin = 0;
    return result;
  }
}

const account = {
  name: 'مدير التجربة',
  country: 'sa',
  phone: '0558318777',
  email: 'owner+otp@gmail.com',
  password: 'secret123',
  persona: 'neutral',
  bio: 'حساب إدارة لاختبار رمز دخول اللوحة.',
};

const kv = new SpyKV();
const hub = new RoleHub();
const mailer = new CaptureMailer();
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let plainApp: Awaited<ReturnType<typeof buildApp>>['app'];

type Target = { inject: (typeof app)['inject'] };
// The routes limit requests per address; every test calls from its own.
let caller = 0;
let contactId = 0;
beforeEach(async () => {
  caller += 1;
  // Every test starts with the account's full hourly budget of codes and wrong guesses.
  await kv.delete(`admin-otp-account:${contactId}`);
});
const post = (target: Target, url: string, payload: Record<string, unknown>, token?: string) =>
  target.inject({ method: 'POST', url, payload, remoteAddress: `10.0.0.${caller}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
const get = (target: Target, url: string, token: string) => target.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

async function challenge(): Promise<string> {
  const res = await post(app, '/api/admin/auth/login', { login: account.email, password: account.password });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().challengeToken as string;
}

before(async () => {
  const base = { LOG_LEVEL: 'silent', HUB_MODE: 'mock' };
  app = (await buildApp({ config: loadConfig({ ...base, ADMIN_OTP: '1' }), kv, hub, mailer })).app;
  plainApp = (await buildApp({ config: loadConfig(base), kv, hub, mailer })).app;
  const registered = await post(app, '/api/auth/register', account);
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post(app, '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  contactId = verified.json().me.id;
});

after(async () => {
  await app.close();
  await plainApp.close();
});

test('with ADMIN_OTP off the dashboard signs in with the hub password alone', async () => {
  const res = await post(plainApp, '/api/admin/auth/login', { login: account.email, password: account.password });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.me.isAdmin, true);
  assert.equal((await get(plainApp, '/api/admin/posts', body.token)).statusCode, 200);
  assert.equal((await plainApp.inject({ method: 'GET', url: '/health' })).json().hub.adminOtp, 'off');
});

test('the password alone gives a challenge, never a session, and the code is only in the mail body', async () => {
  const before = mailer.sent.length;
  const res = await post(app, '/api/admin/auth/login', { login: account.email, password: account.password });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers['cache-control'], 'no-store');
  const body = res.json();
  assert.equal(body.otp, true);
  assert.equal(body.token, undefined);
  assert.equal(body.me, undefined);
  assert.equal(body.seconds, 60);
  assert.equal(body.email, maskEmail(account.email));
  assert.ok(!JSON.stringify(body).includes(account.email));
  assert.equal(mailer.sent.length, before + 1);
  const mail = mailer.sent.at(-1);
  assert.deepEqual(mail?.to, [account.email]);
  const code = mailer.lastCode();
  assert.ok(!mail?.subject.includes(code));
  assert.ok(!JSON.stringify(body).includes(code));
  assert.ok(kv.written.every((value) => !value.includes(`"${code}"`)), 'the code is stored hashed only');
});

test('an app session does not open the dashboard, and the reception screens of the app stay open', async () => {
  const login = await post(app, '/api/auth/login', { login: account.email, password: account.password });
  assert.equal(login.statusCode, 200, login.body);
  const { token } = login.json();
  const posts = await get(app, '/api/admin/posts', token);
  assert.equal(posts.statusCode, 403);
  assert.equal(posts.json().error.code, 'otp_required');
  assert.equal((await get(app, '/api/admin/uploads/config', token)).statusCode, 403);
  assert.equal((await get(app, '/api/admin/payments', token)).statusCode, 403);
  assert.equal((await get(app, '/api/admin/hq/visits', token)).statusCode, 200);
  assert.equal((await get(app, '/api/me', token)).statusCode, 200);
});

test('a wrong code counts down, the right code signs in once', async () => {
  const challengeToken = await challenge();
  const code = mailer.lastCode();
  const wrong = await post(app, '/api/admin/auth/verify', { challengeToken, code: code === '000000' ? '000001' : '000000' });
  assert.equal(wrong.statusCode, 400);
  assert.equal(wrong.json().error.code, 'otp_bad_code');
  assert.match(wrong.json().error.message, /4/);
  const right = await post(app, '/api/admin/auth/verify', { challengeToken, code });
  assert.equal(right.statusCode, 200, right.body);
  const { token, me } = right.json();
  assert.equal(me.isAdmin, true);
  assert.equal((await get(app, '/api/admin/posts', token)).statusCode, 200);
  const again = await post(app, '/api/admin/auth/verify', { challengeToken, code });
  assert.equal(again.statusCode, 410);
});

test('five wrong codes end the challenge, even for the right code', async () => {
  const challengeToken = await challenge();
  const code = mailer.lastCode();
  const bad = code === '111111' ? '222222' : '111111';
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    assert.equal((await post(app, '/api/admin/auth/verify', { challengeToken, code: bad })).statusCode, 400);
  }
  const locked = await post(app, '/api/admin/auth/verify', { challengeToken, code: bad });
  assert.equal(locked.statusCode, 429);
  assert.equal(locked.json().error.code, 'otp_locked');
  assert.equal((await post(app, '/api/admin/auth/verify', { challengeToken, code })).statusCode, 410);
});

test('parallel guesses share the five attempts', async () => {
  const challengeToken = await challenge();
  const code = mailer.lastCode();
  const guesses = Array.from({ length: 12 }, (_, index) => String(100000 + index)).filter((guess) => guess !== code);
  const answers = await Promise.all(guesses.map((guess) => post(app, '/api/admin/auth/verify', { challengeToken, code: guess })));
  assert.equal(answers.filter((answer) => answer.statusCode === 400).length, 4);
  assert.equal((await post(app, '/api/admin/auth/verify', { challengeToken, code })).statusCode, 410);
});

test('a resend right away is refused', async () => {
  const challengeToken = await challenge();
  const res = await post(app, '/api/admin/auth/resend', { challengeToken });
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error.code, 'otp_wait');
});

test('an account without the admin role gets no code', async () => {
  hub.demote = true;
  try {
    const before = mailer.sent.length;
    const res = await post(app, '/api/admin/auth/login', { login: account.email, password: account.password });
    assert.equal(res.statusCode, 403);
    assert.equal(mailer.sent.length, before);
  } finally {
    hub.demote = false;
  }
});

test('a role taken away while the code was on its way stops the sign-in', async () => {
  const challengeToken = await challenge();
  const code = mailer.lastCode();
  hub.demote = true;
  try {
    assert.equal((await post(app, '/api/admin/auth/verify', { challengeToken, code })).statusCode, 403);
  } finally {
    hub.demote = false;
  }
});

test('a mail that cannot leave gives no challenge', async () => {
  mailer.fail = true;
  try {
    const res = await post(app, '/api/admin/auth/login', { login: account.email, password: account.password });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.code, 'otp_mail_failed');
  } finally {
    mailer.fail = false;
  }
});

test('the live hub without SMTP refuses the dashboard instead of skipping the code', async () => {
  const liveHub = new RoleHub();
  liveHub.mode = 'live';
  const built = await buildApp({ config: loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', ADMIN_OTP: '1' }), kv: new MemoryKV(), hub: liveHub });
  try {
    await liveHub.call('register', { uuid: 'app-setup', ip: '127.0.0.1', ...account, job_title: '', page_url: 'app://register' });
    await liveHub.call('verify', { uuid: 'app-setup', code: MOCK_CODE, ip: '127.0.0.1' });
    assert.equal((await built.app.inject({ method: 'GET', url: '/health' })).json().hub.adminOtp, 'no_mail');
    const res = await post(built.app, '/api/admin/auth/login', { login: account.email, password: account.password });
    assert.equal(res.statusCode, 503, res.body);
    assert.equal(res.json().error.code, 'otp_mail_off');
  } finally {
    await built.app.close();
  }
});

test('a dashboard session asks for a new code after ADMIN_SESSION_HOURS', async () => {
  const shortKv = new MemoryKV();
  const shortMailer = new CaptureMailer();
  const built = await buildApp({ config: loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', ADMIN_OTP: '1', ADMIN_SESSION_HOURS: '0.00001' }), kv: shortKv, hub, mailer: shortMailer });
  try {
    const login = await post(built.app, '/api/admin/auth/login', { login: account.email, password: account.password });
    const signedIn = await post(built.app, '/api/admin/auth/verify', { challengeToken: login.json().challengeToken, code: shortMailer.lastCode() });
    assert.equal(signedIn.statusCode, 200, signedIn.body);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const posts = await get(built.app, '/api/admin/posts', signedIn.json().token);
    assert.equal(posts.statusCode, 403);
    assert.equal(posts.json().error.code, 'otp_required');
    assert.equal((await get(built.app, '/api/me', signedIn.json().token)).statusCode, 401, 'the lapsed dashboard session is revoked');
  } finally {
    await built.app.close();
  }
});

test('a new sign-in ends the account\'s earlier challenge', async () => {
  const first = await challenge();
  const firstCode = mailer.lastCode();
  await challenge();
  assert.equal((await post(app, '/api/admin/auth/verify', { challengeToken: first, code: firstCode })).statusCode, 410);
});

test('an account gets six codes an hour, whatever address asks', async () => {
  for (let round = 1; round <= 6; round += 1) await challenge();
  const before = mailer.sent.length;
  const res = await post(app, '/api/admin/auth/login', { login: account.email, password: account.password });
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error.code, 'otp_cooldown');
  assert.equal(mailer.sent.length, before, 'no mail leaves during the cool-down');
});

test('ten wrong codes in an hour close the account\'s dashboard sign-in', async () => {
  const guess = (challengeToken: string, code: string) => post(app, '/api/admin/auth/verify', { challengeToken, code });
  const first = await challenge();
  const bad = (code: string) => (code === '333333' ? '444444' : '333333');
  for (let attempt = 1; attempt <= 5; attempt += 1) await guess(first, bad(mailer.lastCode()));
  const second = await challenge();
  const code = mailer.lastCode();
  for (let attempt = 1; attempt <= 4; attempt += 1) assert.equal((await guess(second, bad(code))).statusCode, 400);
  const tenth = await guess(second, bad(code));
  assert.equal(tenth.statusCode, 429);
  assert.equal(tenth.json().error.code, 'otp_locked');
  assert.equal((await guess(second, code)).statusCode, 410);
  const again = await post(app, '/api/admin/auth/login', { login: account.email, password: account.password });
  assert.equal(again.json().error.code, 'otp_cooldown');
});

test('the code lives its seconds from the mail; a resend replaces it, is limited, and changes nothing when its mail fails', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-20T10:00:00Z') });
  try {
    const store = new AdminOtpStore(new MemoryKV(), 60);
    const codes: string[] = [];
    const deliver = async (_email: string, code: string) => {
      codes.push(code);
    };
    const slowDeliver = async (email: string, code: string) => {
      mock.timers.tick(40_000);
      await deliver(email, code);
    };
    const created = await store.create('app-x', 7, 'a@b.sa', slowDeliver);
    assert.ok(created.ok);
    const { token } = created;
    mock.timers.tick(59_000);
    assert.deepEqual(await store.reissue('x'.repeat(40), deliver), { ok: false, reason: 'gone' });
    await assert.rejects(store.reissue(token, async () => Promise.reject(new Error('smtp down'))));
    assert.deepEqual(await store.check(token, codes[0] === '000000' ? '000001' : '000000'), { ok: false, reason: 'bad_code', attemptsLeft: 4 });
    mock.timers.tick(2_000);
    assert.deepEqual(await store.check(token, codes[0] ?? ''), { ok: false, reason: 'code_expired' });
    assert.deepEqual(await store.reissue(token, deliver), { ok: true });
    mock.timers.tick(5_000);
    assert.deepEqual(await store.reissue(token, deliver), { ok: false, reason: 'too_soon', waitSeconds: 15 });
    for (let send = 3; send <= 4; send += 1) {
      mock.timers.tick(21_000);
      assert.deepEqual(await store.reissue(token, deliver), { ok: true });
    }
    mock.timers.tick(21_000);
    assert.deepEqual(await store.reissue(token, deliver), { ok: false, reason: 'too_many' });
    const fresh = await store.check(token, codes.at(-1) ?? '');
    assert.equal(fresh.ok, true);
    assert.equal((await store.check(token, codes.at(-1) ?? '')).ok, false);
  } finally {
    mock.timers.reset();
  }
});
