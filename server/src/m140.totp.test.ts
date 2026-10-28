import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { stepOf, totpCode } from './auth/totp.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { Mail, Mailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M140 (owner, 2026-10-28): «حماية إضافية» with any authenticator app — optional for members, mandatory for every
// dashboard account while ADMIN_TOTP=1. The mock hub makes every verified account an admin, so one account
// walks both doors: the dashboard enrolment and the member's own switch.
const base = { LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' };

class CaptureMailer implements Mailer {
  readonly configured = true;
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<boolean> {
    this.sent.push(mail);
    return true;
  }
}

const kv = new MemoryKV();
// One mock hub for both servers: the account registered through one signs in through the other.
const hub = new MockHubClient();
const mailer = new CaptureMailer();
let strict: BuiltApp;
let relaxed: BuiltApp;
const account = { name: 'مدير المصادقة', country: 'sa', phone: '0558618899', email: 'm140@gmail.com', password: 'secret123', persona: 'investor', bio: 'حساب اختبار تطبيق المصادقة.' };
let caller = 0;
const call = (app: BuiltApp['app'], method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>, token?: string) =>
  app.inject({ method, url, payload, remoteAddress: `10.1.0.${(caller += 1)}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
/** The code of the NEXT step: never the one the previous sign-in just spent (replay guard), still inside the ±1 window. */
const nextCode = (secret: string, offsetSteps = 1) => totpCode(secret, Date.now() + offsetSteps * 30_000);

let appToken = '';
before(async () => {
  strict = await buildApp({ config: loadConfig({ ...base, ADMIN_TOTP: '1' }), kv, hub, mailer });
  relaxed = await buildApp({ config: loadConfig(base), kv, hub, mailer });
  const registered = await call(strict.app, 'POST', '/api/auth/register', account);
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await call(strict.app, 'POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  appToken = verified.json().token as string;
});

after(async () => {
  await strict.app.close();
  await relaxed.app.close();
});

test('the dashboard enrols an authenticator on the first sign-in, then asks for its code every time; backup codes burn; replays fail', async () => {
  // An app session of an admin never opens the dashboard: the authenticator step is missing.
  const blocked = await call(strict.app, 'GET', '/api/admin/card-requests', undefined, appToken);
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json().error.code, 'totp_required');

  // First dashboard sign-in: no authenticator yet → enrolment with a secret and an otpauth link.
  const first = await call(strict.app, 'POST', '/api/admin/auth/login', { login: account.email, password: account.password });
  assert.equal(first.statusCode, 200, first.body);
  const setup = first.json();
  assert.equal(setup.totpSetup, true);
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.uri, /^otpauth:\/\/totp\/Investors%20Club:m140%40gmail\.com\?secret=[A-Z2-7]{32}&issuer=Investors%20Club&algorithm=SHA1&digits=6&period=30$/);
  const secret = setup.secret as string;

  const wrong = await call(strict.app, 'POST', '/api/admin/auth/totp/enroll', { setupToken: setup.setupToken, code: '000000' });
  assert.equal(wrong.statusCode, 400);
  assert.equal(wrong.json().error.code, 'totp_bad_code');

  const enrolled = await call(strict.app, 'POST', '/api/admin/auth/totp/enroll', { setupToken: setup.setupToken, code: totpCode(secret) });
  assert.equal(enrolled.statusCode, 200, enrolled.body);
  assert.equal(enrolled.json().me.isAdmin, true);
  assert.equal(enrolled.json().backupCodes.length, 8);
  for (const code of enrolled.json().backupCodes as string[]) assert.match(code, /^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  const dashboardToken = enrolled.json().token as string;
  const opened = await call(strict.app, 'GET', '/api/admin/card-requests', undefined, dashboardToken);
  assert.equal(opened.statusCode, 200, opened.body);
  assert.ok(mailer.sent.some((mail) => mail.to.includes(account.email) && mail.subject.includes('تفعيل الحماية الإضافية')), 'the account hears about the new authenticator');

  // Second sign-in: the authenticator step; the code spent at enrolment is a replay.
  const second = await call(strict.app, 'POST', '/api/admin/auth/login', { login: account.email, password: account.password });
  assert.equal(second.json().totp, true, second.body);
  const replay = await call(strict.app, 'POST', '/api/admin/auth/totp/verify', { stepToken: second.json().stepToken, code: totpCode(secret) });
  assert.equal(replay.statusCode, 400, 'the same code never signs in twice');
  const fresh = await call(strict.app, 'POST', '/api/admin/auth/totp/verify', { stepToken: second.json().stepToken, code: nextCode(secret) });
  assert.equal(fresh.statusCode, 200, fresh.body);
  const again = await call(strict.app, 'GET', '/api/admin/card-requests', undefined, fresh.json().token);
  assert.equal(again.statusCode, 200);

  // A backup code works once.
  const backup = enrolled.json().backupCodes[0] as string;
  const third = await call(strict.app, 'POST', '/api/admin/auth/login', { login: account.email, password: account.password });
  const viaBackup = await call(strict.app, 'POST', '/api/admin/auth/totp/verify', { stepToken: third.json().stepToken, code: backup.toLowerCase() });
  assert.equal(viaBackup.statusCode, 200, viaBackup.body);
  const fourth = await call(strict.app, 'POST', '/api/admin/auth/login', { login: account.email, password: account.password });
  const burnt = await call(strict.app, 'POST', '/api/admin/auth/totp/verify', { stepToken: fourth.json().stepToken, code: backup });
  assert.equal(burnt.statusCode, 400);
  const status = await call(strict.app, 'GET', '/api/me/totp', undefined, appToken);
  assert.deepEqual([status.json().enabled, status.json().backupLeft], [true, 7]);

  // Five wrong guesses end the attempt.
  const fifth = await call(strict.app, 'POST', '/api/admin/auth/login', { login: account.email, password: account.password });
  let last = 0;
  for (let i = 0; i < 5; i += 1) last = (await call(strict.app, 'POST', '/api/admin/auth/totp/verify', { stepToken: fifth.json().stepToken, code: '111111' })).statusCode;
  assert.equal(last, 429);
  const gone = await call(strict.app, 'POST', '/api/admin/auth/totp/verify', { stepToken: fifth.json().stepToken, code: nextCode(secret, 2) });
  assert.equal(gone.statusCode, 410);

  // A dashboard account cannot switch the authenticator off while ADMIN_TOTP is on.
  const off = await call(strict.app, 'POST', '/api/me/totp/disable', { code: nextCode(secret, 2) }, appToken);
  assert.equal(off.statusCode, 403);
  assert.equal(off.json().error.code, 'totp_mandatory');
});

test('a member: the app sign-in asks for the code once the protection is on; re-link needs the current code; off again with a code', async () => {
  // The same account on a server without ADMIN_TOTP: the protection is the member's own choice.
  const login = await call(relaxed.app, 'POST', '/api/auth/login', { login: account.email, password: account.password });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().totp, true, 'the account has an authenticator, so the app sign-in waits for its code');
  const state = (await call(relaxed.app, 'GET', '/api/me/totp', undefined, appToken)).json();
  assert.equal(state.enabled, true);

  // Re-link (a new phone): the current code opens a new enrolment; the old secret stays until the new one confirms.
  const refused = await call(relaxed.app, 'POST', '/api/me/totp/setup', {}, appToken);
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.json().error.code, 'totp_code_needed');
  const oldSecret = await currentSecret();
  const relink = await call(relaxed.app, 'POST', '/api/me/totp/setup', { code: await freshCode() }, appToken);
  assert.equal(relink.statusCode, 200, relink.body);
  const newSecret = relink.json().secret as string;
  assert.notEqual(newSecret, oldSecret);
  const confirmed = await call(relaxed.app, 'POST', '/api/me/totp/confirm', { setupToken: relink.json().setupToken, code: totpCode(newSecret) }, appToken);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().backupCodes.length, 8);

  // The app sign-in completes with the new authenticator.
  const step = await call(relaxed.app, 'POST', '/api/auth/login', { login: account.email, password: account.password });
  const signedIn = await call(relaxed.app, 'POST', '/api/auth/totp', { stepToken: step.json().stepToken, code: nextCode(newSecret) });
  assert.equal(signedIn.statusCode, 200, signedIn.body);
  assert.equal(signedIn.json().me.email, account.email);
  const me = await call(relaxed.app, 'GET', '/api/me', undefined, signedIn.json().token);
  assert.equal(me.statusCode, 200);

  // New backup codes replace the old ones; then off, with a code — and the next sign-in is plain again.
  const backup = await call(relaxed.app, 'POST', '/api/me/totp/backup', { code: await freshCode() }, appToken);
  assert.equal(backup.statusCode, 200, backup.body);
  assert.equal(backup.json().backupCodes.length, 8);
  const off = await call(relaxed.app, 'POST', '/api/me/totp/disable', { code: backup.json().backupCodes[0] }, appToken);
  assert.equal(off.statusCode, 200, off.body);
  assert.equal((await call(relaxed.app, 'GET', '/api/me/totp', undefined, appToken)).json().enabled, false);
  const plain = await call(relaxed.app, 'POST', '/api/auth/login', { login: account.email, password: account.password });
  assert.equal(plain.json().pending, false);
  assert.ok(plain.json().token, 'no authenticator: straight to a session');
  assert.ok(mailer.sent.some((mail) => mail.subject.includes('إيقاف الحماية الإضافية')));
});

/** A test runs inside one 30-second step, so the replay guard is rewound before a further code of the same secret is needed. */
async function freshCode(): Promise<string> {
  const me = (await call(relaxed.app, 'GET', '/api/me', undefined, appToken)).json().me as { id: number };
  const record = await kv.get<{ secret: string; lastStep: number }>(`totp:${me.id}`);
  assert.ok(record, 'the account has an authenticator');
  await kv.set(`totp:${me.id}`, { ...record, lastStep: stepOf() - 2 });
  return totpCode(record.secret);
}

/** The live secret of the test account, read from the store (the app only ever sees it at enrolment). */
async function currentSecret(): Promise<string> {
  const me = (await call(relaxed.app, 'GET', '/api/me', undefined, appToken)).json().me as { id: number };
  const record = await kv.get<{ secret: string }>(`totp:${me.id}`);
  assert.ok(record, 'the account has an authenticator');
  return record.secret;
}
