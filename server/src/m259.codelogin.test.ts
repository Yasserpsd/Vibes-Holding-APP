import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { Mail, Mailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M259 (owner, 2026-11-19: «الدخول برمز واتساب بدل كلمة المرور… اعتمد 4 رموز فقط»): a member signs in with his number
// and a four-digit WhatsApp code. Only a number its owner already proved; nothing is sent to anyone else.
const base = { LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', PHONE_CODE_MODE: 'on', WHATSAPP_TOKEN: 'test-token-value-000000', WHATSAPP_PHONE_ID: '11111', WHATSAPP_WABA_ID: '22222' };
const NEW_BUNDLE = 'name,phone,persona,contactEmail,phoneCode';

class CaptureMailer implements Mailer {
  readonly configured = true;
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<boolean> {
    this.sent.push(mail);
    return true;
  }
}

const wa = { codes: [] as { to: string; code: string }[] };
const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
  if (String(url).includes('message_templates')) {
    return new Response(JSON.stringify({ data: [{ name: 'club_login_code', language: 'ar', status: 'APPROVED', category: 'AUTHENTICATION', components: [{ type: 'BODY', text: 'رمزك {{1}}' }] }] }), { status: 200 });
  }
  if (String(url).includes('/messages')) {
    const body = JSON.parse(String(init?.body)) as { to: string; template: { components: { type: string; parameters: { text: string }[] }[] } };
    const text = body.template.components.find((part) => part.type.toLowerCase() === 'body')?.parameters[0]?.text ?? '';
    wa.codes.push({ to: body.to, code: text });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${wa.codes.length}` }] }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
}) as typeof fetch;

const kv = new MemoryKV();
const hub = new MockHubClient();
const mailer = new CaptureMailer();
let built: BuiltApp;
let caller = 0;
const call = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>, target: BuiltApp = built) =>
  target.app.inject({ method, url, payload, remoteAddress: `10.9.0.${(caller += 1)}`, headers: { 'x-app-gate': NEW_BUNDLE, 'x-app-platform': 'ios' } });

let seq = 0;
/** A registered account; `proven` = it signed in once with its password and the WhatsApp code, which marks the number. */
async function member(proven: boolean) {
  seq += 1;
  const account = { name: 'صالح الغامدي', country: 'sa', phone: `05587${String(10000 + seq)}`, email: `m259.${seq}@gmail.com`, password: 'secret123', persona: 'investor', jobTitle: 'مدير تطوير أعمال' };
  const registered = await call('POST', '/api/auth/register', account);
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await call('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  if (proven) {
    const signIn = await call('POST', '/api/auth/login', { login: account.email, password: account.password });
    assert.equal(signIn.json().phoneStep, true, signIn.body);
    const done = await call('POST', '/api/auth/phone/verify', { stepToken: signIn.json().stepToken, code: wa.codes.pop()?.code ?? '' });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(done.json().me.phoneVerified, true);
  }
  wa.codes.length = 0;
  return account;
}

before(async () => {
  built = await buildApp({ config: loadConfig(base), kv, hub, mailer, fetchImpl });
});

after(async () => {
  await built.app.close();
});

test('m259: the sign-in screen is told the code sign-in is on; the switch hides it', async () => {
  assert.equal((await call('GET', '/api/auth/config')).json().codeLogin, true);
  const off = await buildApp({ config: loadConfig({ ...base, CODE_LOGIN: 'off' }), kv, hub, mailer, fetchImpl });
  try {
    assert.equal((await call('GET', '/api/auth/config', undefined, off)).json().codeLogin, false);
    const refused = await call('POST', '/api/auth/code-login/start', { phone: '0558700001', country: 'sa' }, off);
    assert.deepEqual([refused.statusCode, refused.json().error.code], [503, 'code_login_off']);
  } finally {
    await off.app.close();
  }
});

test('m259: a proven number signs in with a four-digit WhatsApp code and no password', async () => {
  const account = await member(true);
  const started = await call('POST', '/api/auth/code-login/start', { phone: account.phone, country: 'sa' });
  assert.equal(started.statusCode, 200, started.body);
  const step = started.json();
  assert.deepEqual([step.phoneStep, step.via, step.token], [true, 'whatsapp', undefined]);
  assert.match(step.phone, /^•••\d{3}$/);
  assert.equal(wa.codes.length, 1, 'one WhatsApp message');
  const code = wa.codes[0]?.code ?? '';
  assert.match(code, /^\d{4}$/);
  const wrong = await call('POST', '/api/auth/code-login/verify', { stepToken: step.stepToken, code: code === '1111' ? '2222' : '1111' });
  assert.deepEqual([wrong.statusCode, wrong.json().error.code], [400, 'otp_bad_code']);
  // The code of a password-less sign-in does not end an ordinary sign-in step, and the other way round.
  const crossed = await call('POST', '/api/auth/phone/verify', { stepToken: step.stepToken, code });
  assert.notEqual(crossed.statusCode, 200);
  const again = await call('POST', '/api/auth/code-login/start', { phone: account.phone.slice(1), country: 'sa' });
  assert.equal(again.statusCode, 200, again.body);
  const right = await call('POST', '/api/auth/code-login/verify', { stepToken: again.json().stepToken, code: wa.codes[wa.codes.length - 1]?.code ?? '' });
  assert.equal(right.statusCode, 200, right.body);
  assert.ok(right.json().token, 'a session');
  assert.equal(right.json().me.email, account.email);
  const me = await built.app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${right.json().token as string}`, 'x-app-gate': NEW_BUNDLE } });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(mailer.sent.filter((mail) => /رمز الدخول|Your Investors Club code/.test(mail.subject)).length, 0, 'the code never goes by e-mail');
});

test('m259: nothing is sent to a number that cannot sign in by code', async () => {
  const unknown = await call('POST', '/api/auth/code-login/start', { phone: '0558799999', country: 'sa' });
  assert.deepEqual([unknown.statusCode, unknown.json().error.code], [404, 'no_account']);
  // Registered, but the number never received a code: the password first.
  const fresh = await member(false);
  const unproven = await call('POST', '/api/auth/code-login/start', { phone: fresh.phone, country: 'sa' });
  assert.deepEqual([unproven.statusCode, unproven.json().error.code], [403, 'code_login_password']);
  const english = await built.app.inject({ method: 'POST', url: '/api/auth/code-login/start', payload: { phone: fresh.phone, country: 'sa' }, remoteAddress: '10.9.9.1', headers: { 'x-app-lang': 'en', 'x-app-platform': 'ios' } });
  assert.match(english.json().error.message, /^Sign-in with a code is not available for this account yet/);
  assert.equal(wa.codes.length, 0, 'no paid message left');
  const bad = await call('POST', '/api/auth/code-login/start', { phone: '12', country: 'sa' });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.field, 'phone');
});

test('m259: an account asks for a few codes a day at most, and the password still opens it', async () => {
  // Two a day here, so the test stays under WhatsApp's own ceiling of three codes an hour to one number.
  const capped = await buildApp({ config: loadConfig({ ...base, CODE_LOGIN_DAILY: '2' }), kv, hub, mailer, fetchImpl });
  try {
    const account = await member(true);
    for (let index = 0; index < 2; index += 1) {
      const started = await call('POST', '/api/auth/code-login/start', { phone: account.phone, country: 'sa' }, capped);
      assert.equal(started.statusCode, 200, started.body);
    }
    const third = await call('POST', '/api/auth/code-login/start', { phone: account.phone, country: 'sa' }, capped);
    assert.deepEqual([third.statusCode, third.json().error.code], [429, 'code_login_spent']);
    assert.equal(wa.codes.length, 2, 'the refused request sent nothing');
    const signIn = await call('POST', '/api/auth/login', { login: account.email, password: account.password }, capped);
    assert.equal(signIn.statusCode, 200, signIn.body);
  } finally {
    await capped.app.close();
  }
});
