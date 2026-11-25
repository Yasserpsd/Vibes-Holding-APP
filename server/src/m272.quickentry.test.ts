import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { LEGACY_KEY } from './auth/legacy.js';
import { RefusalCounter } from './auth/refusals.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubClient } from './hub/types.js';
import type { Mail, Mailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M272 (owner, 2026-11-25: «يدخل الرقم ولو مفيش عليه حساب يجيله كود واتس اب وبعدين يكمل تسجيل، ولو في حساب بالفعل
// يجيله كود ويدخل»): one number field on the gate. No «no account» dead end.
const base = { LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', PHONE_CODE_MODE: 'on', WHATSAPP_TOKEN: 'test-token-value-000000', WHATSAPP_PHONE_ID: '11111', WHATSAPP_WABA_ID: '22222' };
const BUNDLE = 'name,phone,persona,jobTitle,contactEmail,phoneCode,waCodes,phoneFirst';

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
    wa.codes.push({ to: body.to, code: body.template.components.find((part) => part.type.toLowerCase() === 'body')?.parameters[0]?.text ?? '' });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${wa.codes.length}` }] }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
}) as typeof fetch;

const kv = new MemoryKV();
const hub = new MockHubClient();
const mailer = new CaptureMailer();
let built: BuiltApp;
let caller = 0;
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>, options: { target?: BuiltApp; token?: string; gate?: string } = {}) =>
  (options.target ?? built).app.inject({
    method,
    url,
    payload,
    remoteAddress: `10.27.${Math.floor((caller += 1) / 250)}.${caller % 250}`,
    headers: { 'x-app-gate': options.gate ?? BUNDLE, 'x-app-platform': 'ios', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
  });

let seq = 0;
const nextPhone = () => `05527${String(10000 + (seq += 1))}`;
const lastCode = () => wa.codes[wa.codes.length - 1]?.code ?? '';
const wrongFor = (code: string) => (code === '1111' ? '2222' : '1111');

/** The whole quick sign-up of a new number: gate → code → short form. */
async function signUp(phone: string, extra: Record<string, unknown> = {}, target = built) {
  const started = await call('POST', '/api/auth/quick/start', { phone, country: 'sa' }, { target });
  assert.equal(started.statusCode, 200, started.body);
  assert.equal(started.json().kind, 'signup', started.body);
  const proven = await call('POST', '/api/auth/phone-proof/confirm', { stepToken: started.json().stepToken, code: lastCode() }, { target });
  assert.equal(proven.statusCode, 200, proven.body);
  const form = { name: 'سالم القحطاني', country: 'sa', phone, persona: 'neutral', personaDefaulted: true, jobTitle: 'مدير مشاريع', phoneProof: proven.json().proof, ...extra };
  return { start: started.json(), proof: proven.json().proof as string, form, done: await call('POST', '/api/auth/register', form, { target }) };
}

/** An account made the long way, with a password; `proven` = it passed the WhatsApp code once. */
async function oldMember(proven: boolean) {
  const phone = nextPhone();
  const account = { name: 'صالح الغامدي', country: 'sa', phone, email: `m272.${seq}@gmail.com`, password: 'secret123', persona: 'investor', jobTitle: 'مدير تطوير أعمال' };
  const registered = await call('POST', '/api/auth/register', account, { gate: 'name,phone' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await call('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE }, { gate: 'name,phone' });
  assert.equal(verified.statusCode, 200, verified.body);
  if (proven) {
    const signIn = await call('POST', '/api/auth/login', { login: account.email, password: account.password });
    const done = await call('POST', '/api/auth/phone/verify', { stepToken: signIn.json().stepToken, code: lastCode() });
    assert.equal(done.statusCode, 200, done.body);
  }
  wa.codes.length = 0;
  return { ...account, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config: loadConfig(base), kv, hub, mailer, fetchImpl });
});

after(async () => {
  await built.app.close();
});

test('m272: the gate is told to draw the number field; switching code sign-in off takes it away', async () => {
  assert.equal((await call('GET', '/api/auth/config')).json().quickEntry, true);
  const off = await buildApp({ config: loadConfig({ ...base, CODE_LOGIN: 'off' }), kv, hub, mailer, fetchImpl });
  try {
    assert.equal((await call('GET', '/api/auth/config', undefined, { target: off })).json().quickEntry, false);
    const refused = await call('POST', '/api/auth/quick/start', { phone: nextPhone(), country: 'sa' }, { target: off });
    assert.deepEqual([refused.statusCode, refused.json().error.code], [503, 'code_login_off']);
  } finally {
    await off.app.close();
  }
});

test('m272: a number with an account gets its sign-in code; a wrong code keeps the step, the right one signs in', async () => {
  const account = await oldMember(true);
  const started = await call('POST', '/api/auth/quick/start', { phone: account.phone, country: 'sa' });
  assert.deepEqual([started.statusCode, started.json().kind, started.json().token], [200, 'signin', undefined], started.body);
  const wrong = await call('POST', '/api/auth/code-login/verify', { stepToken: started.json().stepToken, code: wrongFor(lastCode()) });
  assert.deepEqual([wrong.statusCode, wrong.json().error.code], [400, 'otp_bad_code']);
  const right = await call('POST', '/api/auth/code-login/verify', { stepToken: started.json().stepToken, code: lastCode() });
  assert.equal(right.statusCode, 200, right.body);
  assert.equal(right.json().me.email, account.email);
});

test('m272: a new number proves itself and the name and job make a signed-in account with no e-mail and no password', async () => {
  const phone = nextPhone();
  const mails = mailer.sent.length;
  const { start, done } = await signUp(phone);
  assert.equal(start.needsEmail, false);
  assert.match(start.phone, /^•••\d{3}$/);
  assert.equal(done.statusCode, 200, done.body);
  const { token, me } = done.json();
  assert.ok(token, 'a session');
  assert.deepEqual([me.email, me.persona, me.phoneVerified, me.profileMissing], ['', 'neutral', true, []]);
  assert.equal(mailer.sent.length, mails, 'no mail to nobody');
  // The same number comes back with a code alone.
  wa.codes.length = 0;
  const again = await call('POST', '/api/auth/quick/start', { phone, country: 'sa' });
  assert.equal(again.json().kind, 'signin', again.body);
  const back = await call('POST', '/api/auth/code-login/verify', { stepToken: again.json().stepToken, code: lastCode() });
  assert.equal(back.json().me.id, me.id);
});

test('m272: two number-only accounts do not collide on their empty e-mail', async () => {
  const first = await signUp(nextPhone());
  const second = await signUp(nextPhone());
  assert.equal(second.done.statusCode, 200, second.done.body);
  assert.notEqual(second.done.json().me.id, first.done.json().me.id);
});

test('m272: an e-mail is left out only on a proven number', async () => {
  const bare = await call('POST', '/api/auth/register', { name: 'سالم القحطاني', country: 'sa', phone: nextPhone(), persona: 'neutral', jobTitle: 'مدير مشاريع', password: 'secret123' }, { gate: 'name,phone' });
  assert.deepEqual([bare.statusCode, bare.json().error.code], [400, 'email_required']);
});

test('m272: an older hub makes the short form ask for the e-mail, and the form then works', async () => {
  hub.emailOptional = false;
  try {
    const phone = nextPhone();
    const { start, proof, form, done } = await signUp(phone);
    assert.equal(start.needsEmail, true);
    assert.deepEqual([done.statusCode, done.json().error.code], [400, 'email_required']);
    const withEmail = await call('POST', '/api/auth/register', { ...form, phoneProof: proof, email: `m272.old.${seq}@gmail.com` });
    assert.equal(withEmail.statusCode, 200, withEmail.body);
    assert.ok(withEmail.json().token);
  } finally {
    hub.emailOptional = true;
  }
});

test('m272: an expired or spent code is refused and nothing is created', async () => {
  const phone = nextPhone();
  const started = await call('POST', '/api/auth/quick/start', { phone, country: 'sa' });
  for (let index = 0; index < 4; index += 1) {
    assert.equal((await call('POST', '/api/auth/phone-proof/confirm', { stepToken: started.json().stepToken, code: wrongFor(lastCode()) })).json().error.code, 'otp_bad_code');
  }
  assert.equal((await call('POST', '/api/auth/phone-proof/confirm', { stepToken: started.json().stepToken, code: wrongFor(lastCode()) })).json().error.code, 'otp_locked');
  assert.equal((await call('POST', '/api/auth/phone-proof/confirm', { stepToken: started.json().stepToken, code: lastCode() })).json().error.code, 'otp_expired');
  // Time passing: the stored step is aged past its ten minutes.
  const other = await call('POST', '/api/auth/quick/start', { phone: nextPhone(), country: 'sa' });
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60_000;
  try {
    const late = await call('POST', '/api/auth/phone-proof/confirm', { stepToken: other.json().stepToken, code: lastCode() });
    assert.deepEqual([late.statusCode, ['otp_expired', 'otp_code_expired'].includes(late.json().error.code)], [late.statusCode, true], late.body);
    assert.notEqual(late.statusCode, 200);
  } finally {
    Date.now = realNow;
  }
});

test('m272: the first choice after a defaulted «محايد» does not use up the yearly change; the second does', async () => {
  // The mock hub calls every account an admin, and admins have no yearly window: here they are ordinary members.
  const members: HubClient = {
    mode: 'mock',
    call: async (op, body) => {
      const answer = await hub.call(op, body);
      return answer.contact ? { ...answer, contact: { ...answer.contact, is_admin: 0 } } : answer;
    },
  };
  const plain = await buildApp({ config: loadConfig(base), kv, hub: members, mailer, fetchImpl });
  try {
    const { done } = await signUp(nextPhone(), {}, plain);
    assert.equal(done.json().me.isAdmin, false);
    const token = done.json().token as string;
    const choose = async (persona: string) => {
      const asked = await call('POST', '/api/me/persona/request', { persona }, { target: plain, token });
      assert.equal(asked.statusCode, 200, asked.body);
      const code = asked.json().via === 'whatsapp' ? lastCode() : /(\d{6})/.exec(mailer.sent[mailer.sent.length - 1]?.text ?? '')?.[1];
      const confirmed = await call('POST', '/api/me/persona/confirm', { code }, { target: plain, token });
      assert.equal(confirmed.statusCode, 200, confirmed.body);
      return (await call('GET', '/api/me/persona/state', undefined, { target: plain, token })).json().daysLeft as number;
    };
    assert.equal(await choose('investor'), 0, 'the first choice is free');
    assert.equal(await choose('entrepreneur'), 365, 'the next one is the yearly change');
  } finally {
    await plain.app.close();
  }
});

test('m272: an account the code cannot open is counted by its real cause, and the password then proves the number', async () => {
  const account = await oldMember(false);
  const refused = await call('POST', '/api/auth/quick/start', { phone: account.phone, country: 'sa' });
  assert.deepEqual([refused.statusCode, refused.json().error.code], [403, 'code_login_password']);
  assert.equal(wa.codes.length, 0, 'no paid message');
  // The account is made one from before the WhatsApp sign-up: its password alone used to be the whole sign-in.
  await kv.set(LEGACY_KEY, { ids: [account.id], before: new Date().toISOString(), takenAt: new Date().toISOString(), by: 'test' });
  const old = await buildApp({ config: loadConfig(base), kv, hub, mailer, fetchImpl });
  try {
    const login = { login: account.phone, password: account.password, country: 'sa' };
    const plain = await call('POST', '/api/auth/login', login, { target: old });
    assert.ok(plain.json().token, plain.body);
    const signIn = await call('POST', '/api/auth/login', { ...login, confirmNumber: true }, { target: old });
    assert.equal(signIn.json().phoneStep, true, signIn.body);
    const proven = await call('POST', '/api/auth/phone/verify', { stepToken: signIn.json().stepToken, code: lastCode() }, { target: old });
    assert.equal(proven.statusCode, 200, proven.body);
    const now = await call('POST', '/api/auth/quick/start', { phone: account.phone, country: 'sa' }, { target: old });
    assert.equal(now.json().kind, 'signin', now.body);
  } finally {
    await old.app.close();
    await kv.delete(LEGACY_KEY);
  }
});

test('m272: the dashboard names why a code sign-in was refused, and on which phone', async () => {
  const counter = new RefusalCounter(new MemoryKV());
  counter.refused('login', 'code_login_password', 'app-ios', 'phone_unproven');
  counter.refused('login', 'code_login_password', 'app-android');
  counter.refused('login', 'code_login_spent', 'app-android');
  const login = (await counter.report(1)).steps.find((step) => step.step === 'login');
  assert.deepEqual(
    login?.reasons.map((reason) => [reason.label, reason.ios, reason.android]).sort(),
    [
      ['استنفد رموز الدخول المتاحة لليوم', 0, 1],
      ['الحساب لا يدخل بالرمز بعد (يحتاج كلمة المرور مرة واحدة)', 0, 1],
      ['الدخول بالرمز مرفوض: رقم الحساب لم يُؤكَّد على واتساب بعد', 1, 0],
    ].sort(),
  );
});

test('m272: with CODE_LOGIN_UNPROVEN on, the code itself proves the number', async () => {
  const account = await oldMember(false);
  const open = await buildApp({ config: loadConfig({ ...base, CODE_LOGIN_UNPROVEN: 'on' }), kv, hub, mailer, fetchImpl });
  try {
    const started = await call('POST', '/api/auth/quick/start', { phone: account.phone, country: 'sa' }, { target: open });
    assert.equal(started.json().kind, 'signin', started.body);
    const done = await call('POST', '/api/auth/code-login/verify', { stepToken: started.json().stepToken, code: lastCode() }, { target: open });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(done.json().me.phoneVerified, true);
  } finally {
    await open.app.close();
  }
});
