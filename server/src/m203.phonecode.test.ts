import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { PhoneCodeStore } from './auth/phoneCode.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { Mail, Mailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M203 (owner, 2026-11-06): WhatsApp is the proof of identity. Every new sign-in passes a code, a session that stays open
// asks for nothing, the store reviewers pass with no code, and a bundle that cannot draw the step signs in as before.
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

/** Meta on the wire: the template list, and every code as it left. `refuse` makes Meta answer an error. */
const wa = { codes: [] as { to: string; code: string }[], refuse: false };
const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
  if (String(url).includes('message_templates')) {
    return new Response(JSON.stringify({ data: [{ name: 'club_login_code', language: 'ar', status: 'APPROVED', category: 'AUTHENTICATION', components: [{ type: 'BODY', text: 'رمزك {{1}}' }] }] }), { status: 200 });
  }
  if (String(url).includes('/messages')) {
    if (wa.refuse) return new Response(JSON.stringify({ error: { code: 131026, message: 'undeliverable' } }), { status: 400 });
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
let app: BuiltApp['app'];
let built: BuiltApp;
let caller = 0;
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>, token?: string, gate: string | null = NEW_BUNDLE) =>
  app.inject({ method, url, payload, remoteAddress: `10.2.0.${(caller += 1)}`, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(gate ? { 'x-app-gate': gate } : {}) } });

let seq = 0;
async function member(email = `m202.${(seq += 1)}@gmail.com`, phone = `05586${String(10000 + (seq += 1))}`) {
  const account = { name: 'صالح الغامدي', country: 'sa', phone, email, password: 'secret123', persona: 'investor', jobTitle: 'مدير تطوير أعمال' };
  const registered = await call('POST', '/api/auth/register', account);
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await call('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { ...account, token: verified.json().token as string, me: verified.json().me as { profileMissing: string[]; phoneVerified: boolean } };
}

before(async () => {
  built = await buildApp({ config: loadConfig(base), kv, hub, mailer, fetchImpl });
  app = built.app;
});

after(async () => {
  await built.app.close();
});

test('m203: the short sign-up needs no bio, interests or member type, and opens with nothing missing', async () => {
  const account = await member();
  assert.deepEqual(account.me.profileMissing, []);
});

test('m203: a sign-in stops at the code; the right code signs in and marks the number', async () => {
  const account = await member();
  wa.codes.length = 0;
  const signIn = await call('POST', '/api/auth/login', { login: account.email, password: account.password });
  assert.equal(signIn.statusCode, 200, signIn.body);
  const step = signIn.json();
  assert.equal(step.phoneStep, true);
  assert.equal(step.token, undefined, 'no session before the code');
  assert.equal(step.via, 'whatsapp');
  assert.match(step.phone, /^•••\d{3}$/);
  const code = wa.codes.pop()?.code ?? '';
  assert.match(code, /^\d{4}$/);
  const wrong = await call('POST', '/api/auth/phone/verify', { stepToken: step.stepToken, code: code === '1111' ? '2222' : '1111' });
  assert.equal(wrong.statusCode, 400);
  const right = await call('POST', '/api/auth/phone/verify', { stepToken: step.stepToken, code });
  assert.equal(right.statusCode, 200, right.body);
  assert.ok(right.json().token);
  assert.equal(right.json().fixPhone, false);
  assert.equal(right.json().me.phoneVerified, true);
  const again = await call('POST', '/api/auth/phone/verify', { stepToken: step.stepToken, code });
  assert.notEqual(again.statusCode, 200, 'a code works once');
});

test('m203: a session that stays open asks for nothing', async () => {
  const account = await member();
  const me = await call('GET', '/api/me', undefined, account.token);
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().me.phoneVerified, false);
  assert.deepEqual(me.json().me.profileMissing, []);
});

test('m203: an unconfirmed number raises the alert in an open session, and the code clears it', async () => {
  const account = await member();
  const before = (await call('GET', '/api/me', undefined, account.token)).json().me;
  assert.equal(before.phoneConfirmDue, true);
  wa.codes.length = 0;
  const step = await call('POST', '/api/me/phone/confirm', {}, account.token);
  assert.equal(step.statusCode, 200, step.body);
  const done = await call('POST', '/api/me/phone/verify', { stepToken: step.json().stepToken, code: wa.codes.at(-1)?.code }, account.token);
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().me.phoneVerified, true);
  assert.equal(done.json().me.phone, account.phone);
  assert.equal(done.json().me.phoneConfirmDue, false);
  const signIn = await call('POST', '/api/auth/login', { login: account.email, password: account.password });
  assert.equal(signIn.json().phoneStep, true, 'a confirmed number still gets its code at every new sign-in');
});

test('m203: a store reviewer never sees the alert, nor does anyone with the switch off', async () => {
  const account = await member('development+appledemo@vibesholding.com.test');
  assert.equal((await call('GET', '/api/me', undefined, account.token)).json().me.phoneConfirmDue, true);
  const off = await buildApp({ config: loadConfig({ ...base, PHONE_CODE_MODE: 'off' }), kv, hub, mailer, fetchImpl });
  try {
    const me = await off.app.inject({ method: 'GET', url: '/api/me', remoteAddress: '10.2.1.9', headers: { authorization: `Bearer ${account.token}` } });
    assert.equal(me.json().me.phoneConfirmDue, false);
  } finally {
    await off.app.close();
  }
  const exempt = await buildApp({ config: loadConfig({ ...base, PHONE_CODE_EXEMPT: account.email }), kv, hub, mailer, fetchImpl });
  try {
    const me = await exempt.app.inject({ method: 'GET', url: '/api/me', remoteAddress: '10.2.1.10', headers: { authorization: `Bearer ${account.token}` } });
    assert.equal(me.json().me.phoneConfirmDue, false);
  } finally {
    await exempt.app.close();
  }
});

test('m203: an older bundle signs in as before', async () => {
  const account = await member();
  const signIn = await call('POST', '/api/auth/login', { login: account.email, password: account.password }, undefined, 'name,memberType,phone,persona,bio,jobTitle,interests,company,contactEmail');
  assert.equal(signIn.statusCode, 200, signIn.body);
  assert.ok(signIn.json().token);
  const none = await call('POST', '/api/auth/login', { login: account.email, password: account.password }, undefined, null);
  assert.ok(none.json().token);
});

test('m203: the store reviewers sign in with no code', async () => {
  for (const email of ['ceo@vibesholding.com', 'development+appledemo@vibesholding.com']) {
    const account = await member(email);
    const signIn = await call('POST', '/api/auth/login', { login: account.email, password: account.password });
    assert.ok(signIn.json().token, signIn.body);
  }
});

test('m204: WhatsApp is the only channel: a bundle from before M204 asking for the e-mail is told so, and nothing is mailed', async () => {
  const account = await member();
  const step = (await call('POST', '/api/auth/login', { login: account.email, password: account.password })).json();
  mailer.sent.length = 0;
  const out = await call('POST', '/api/auth/phone/resend', { stepToken: step.stepToken, via: 'email' });
  assert.equal(out.statusCode, 400, out.body);
  assert.equal(out.json().error.code, 'phone_code_whatsapp_only');
  assert.equal(mailer.sent.length, 0);
});

const mailedCode = (): string => /\d{4}/.exec(mailer.sent.at(-1)?.text ?? '')?.[0] ?? '';

test('m204: Meta refused the send: the code goes to the e-mail by itself, signs in and proves nothing about the number', async () => {
  const account = await member();
  wa.refuse = true;
  mailer.sent.length = 0;
  const signIn = await call('POST', '/api/auth/login', { login: account.email, password: account.password });
  wa.refuse = false;
  assert.equal(signIn.statusCode, 200, signIn.body);
  assert.equal(signIn.json().via, 'email');
  assert.equal(signIn.json().token, undefined);
  assert.equal(mailer.sent.length, 1);
  assert.deepEqual(mailer.sent[0]?.to, [account.email]);
  const done = await call('POST', '/api/auth/phone/verify', { stepToken: signIn.json().stepToken, code: mailedCode() });
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().fixPhone, true);
  assert.equal(done.json().me.phoneVerified, false);
});

test('m204: Meta accepted the code and then reported it undelivered: a new code is mailed once and ends the sign-in', async () => {
  const account = await member();
  mailer.sent.length = 0;
  const step = (await call('POST', '/api/auth/login', { login: account.email, password: account.password })).json();
  assert.equal(step.via, 'whatsapp');
  assert.equal(mailer.sent.length, 0);
  const failed = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: `wamid.${wa.codes.length}`, status: 'failed', recipient_id: wa.codes.at(-1)?.to, errors: [{ code: 131026, title: 'Message undeliverable' }] }] } }] }] });
  const hook = () => app.inject({ method: 'POST', url: '/api/whatsapp/webhook', headers: { 'content-type': 'application/json' }, payload: failed });
  assert.equal((await hook()).json().statuses, 1);
  assert.equal(mailer.sent.length, 1);
  assert.deepEqual(mailer.sent[0]?.to, [account.email]);
  // Meta repeats a status: no second mail.
  await hook();
  assert.equal(mailer.sent.length, 1);
  const done = await call('POST', '/api/auth/phone/verify', { stepToken: step.stepToken, code: mailedCode() });
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().fixPhone, true);
});

test('m203: the WhatsApp resend waits a minute', async () => {
  const account = await member();
  const step = (await call('POST', '/api/auth/login', { login: account.email, password: account.password })).json();
  const soon = await call('POST', '/api/auth/phone/resend', { stepToken: step.stepToken });
  assert.equal(soon.statusCode, 429);
});

test('m204: a number an admin vouched for signs in with no code and raises no alert; taking the word back restores both', async () => {
  const account = await member();
  const id = (account.me as unknown as { id: number }).id;
  const waivers = new PhoneCodeStore(kv, async () => ({ sent: true }));
  await waivers.waive(id, 'مدير الاختبار');
  assert.equal((await waivers.waiver(id))?.by, 'مدير الاختبار');
  assert.equal((await call('GET', '/api/me', undefined, account.token)).json().me.phoneConfirmDue, false);
  wa.codes.length = 0;
  const signIn = await call('POST', '/api/auth/login', { login: account.email, password: account.password });
  assert.ok(signIn.json().token, signIn.body);
  assert.equal(wa.codes.length, 0, 'no paid message for a vouched number');
  await waivers.unwaive(id);
  assert.equal((await call('GET', '/api/me', undefined, account.token)).json().me.phoneConfirmDue, true);
  assert.equal((await call('POST', '/api/auth/login', { login: account.email, password: account.password })).json().phoneStep, true);
});

test('m203: a new number is saved only after its code; another account\'s number is refused before a paid message', async () => {
  const first = await member();
  const second = await member();
  wa.codes.length = 0;
  const taken = await call('POST', '/api/me/phone/start', { phone: first.phone, country: 'sa' }, second.token);
  assert.equal(taken.statusCode, 400, taken.body);
  assert.equal(wa.codes.length, 0);
  const started = await call('POST', '/api/me/phone/start', { phone: '0558699001', country: 'sa' }, second.token);
  assert.equal(started.statusCode, 200, started.body);
  assert.equal(started.json().phoneStep, true);
  const unchanged = (await call('GET', '/api/me', undefined, second.token)).json().me;
  assert.equal(unchanged.phone, second.phone);
  const wrongOwner = await call('POST', '/api/me/phone/verify', { stepToken: started.json().stepToken, code: wa.codes.at(-1)?.code }, first.token);
  assert.notEqual(wrongOwner.statusCode, 200, 'a step belongs to its account');
  const verified = await call('POST', '/api/me/phone/verify', { stepToken: started.json().stepToken, code: wa.codes.at(-1)?.code }, second.token);
  assert.equal(verified.statusCode, 200, verified.body);
  assert.equal(verified.json().me.phone, '0558699001');
  assert.equal(verified.json().me.phoneVerified, true);
});

test('m203: reset names the channel only for a bundle that asks for one', async () => {
  const account = await member();
  const newBundle = await call('POST', '/api/auth/reset/request', { login: account.email, channel: 'whatsapp' });
  assert.equal(newBundle.json().via, 'whatsapp', newBundle.body);
  const mail = await call('POST', '/api/auth/reset/request', { login: account.email, channel: 'mail' });
  assert.equal(mail.json().via, 'mail');
  const oldBundle = await call('POST', '/api/auth/reset/request', { login: account.email });
  assert.equal(oldBundle.json().via, 'mail');
});

test('m203: the switch off asks for nothing and saves a number directly', async () => {
  const off = await buildApp({ config: loadConfig({ ...base, PHONE_CODE_MODE: 'off' }), kv, hub, mailer, fetchImpl });
  try {
    const account = await member();
    const signIn = await off.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: account.email, password: account.password }, remoteAddress: '10.2.1.1', headers: { 'x-app-gate': NEW_BUNDLE } });
    assert.ok(signIn.json().token, signIn.body);
    const started = await off.app.inject({ method: 'POST', url: '/api/me/phone/start', payload: { phone: '0558699002', country: 'sa' }, remoteAddress: '10.2.1.2', headers: { 'x-app-gate': NEW_BUNDLE, authorization: `Bearer ${signIn.json().token as string}` } });
    assert.equal(started.json().saved, true, started.body);
    assert.equal(started.json().me.phone, '0558699002');
  } finally {
    await off.app.close();
  }
});

test('m203: strict refuses a bundle that cannot draw the step', async () => {
  const strict = await buildApp({ config: loadConfig({ ...base, PHONE_CODE_MODE: 'strict' }), kv, hub, mailer, fetchImpl });
  try {
    const account = await member();
    const signIn = await strict.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: account.email, password: account.password }, remoteAddress: '10.2.1.3' });
    assert.equal(signIn.statusCode, 403, signIn.body);
    assert.equal(signIn.json().error.code, 'phone_code_update');
  } finally {
    await strict.app.close();
  }
});

test('m204: the persona-change and deletion codes go to the proven WhatsApp number of a bundle that can say so; an older bundle keeps the e-mail', async () => {
  const account = await member();
  const step = (await call('POST', '/api/auth/login', { login: account.email, password: account.password })).json();
  const session = (await call('POST', '/api/auth/phone/verify', { stepToken: step.stepToken, code: wa.codes.at(-1)?.code ?? '' })).json();
  assert.equal(session.me.phoneVerified, true);
  const NEWEST = `${NEW_BUNDLE},waCodes`;

  wa.codes.length = 0;
  mailer.sent.length = 0;
  const persona = await call('POST', '/api/me/persona/request', { persona: 'entrepreneur' }, session.token, NEWEST);
  assert.equal(persona.statusCode, 200, persona.body);
  assert.equal(persona.json().via, 'whatsapp');
  assert.match(persona.json().phone, /^•••\d{3}$/);
  assert.equal(wa.codes.length, 1);
  assert.equal(mailer.sent.length, 0);
  // Meta reports that message undelivered: the SAME code goes to the e-mail by itself.
  const failed = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'failed', recipient_id: wa.codes[0]?.to, errors: [{ code: 131026, title: 'Message undeliverable' }] }] } }] }] });
  await app.inject({ method: 'POST', url: '/api/whatsapp/webhook', headers: { 'content-type': 'application/json' }, payload: failed });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mailer.sent.length, 1);
  assert.ok(mailer.sent[0]?.text?.includes(wa.codes[0]?.code ?? 'none'));

  mailer.sent.length = 0;
  const removal = await call('POST', '/api/me/delete/start', { password: account.password }, session.token, NEW_BUNDLE);
  assert.equal(removal.statusCode, 200, removal.body);
  assert.equal(removal.json().via, 'email');
  assert.equal(wa.codes.length, 1);
  assert.equal(mailer.sent.length, 1);
});
