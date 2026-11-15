import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { ensureMembershipSeed } from '../content/membership.js';
import { MOCK_CODE, MockHubClient } from '../hub/mock.js';
import { cleanEmail, isEmailShape, normEmail, normLogin } from '../hub/phone.js';
import { HubError, type HubBody, type HubClient, type HubContact, type HubOp, type HubResponse } from '../hub/types.js';
import { MemoryKV } from '../store.js';

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];

const registration = {
  name: 'سالم التجريبي',
  country: 'sa',
  phone: '0558318777',
  email: 'salem+member@gmail.com',
  password: 'secret123',
  persona: 'investor',
  bio: 'مستثمر مهتم بفرص الشراكة في قطاع التقنية.',
};

const post = async (url: string, payload: Record<string, unknown>, token?: string) =>
  app.inject({ method: 'POST', url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

before(async () => {
  await ensureMembershipSeed(kv);
  const built = await buildApp({ config, kv, hub: new MockHubClient() });
  app = built.app;
});

after(async () => {
  await app.close();
});

test('auth config lists GCC countries and personas without caching', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/config' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const body = res.json();
  assert.equal(body.countries[0].code, 'sa');
  assert.equal(body.personas.length, 3);
  assert.equal(body.registrationOpen, true);
  // M79-launch: the test app is open by default — anyone registers and signs in to try the personas.
  assert.equal(body.adminOnly, false);
  assert.equal(body.testCode, MOCK_CODE);
});

test('membership content is served without prices', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/membership' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.benefits.length >= 5);
  assert.ok(!JSON.stringify(body).includes('1,899'));
  assert.ok(!JSON.stringify(body).includes('paymob'));
});

test('register → verify → me → logout', async () => {
  const registered = await post('/api/auth/register', registration);
  assert.equal(registered.statusCode, 200, registered.body);
  const { pendingToken, email } = registered.json();
  assert.equal(email, registration.email);
  assert.ok(pendingToken.length >= 32);

  const wrong = await post('/api/auth/verify', { pendingToken, code: '000000' });
  assert.equal(wrong.statusCode, 400);
  assert.equal(wrong.json().error.code, 'bad_code');

  const resent = await post('/api/auth/resend', { pendingToken });
  assert.equal(resent.statusCode, 200);

  const verified = await post('/api/auth/verify', { pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  const { token, me } = verified.json();
  assert.ok(token.length >= 32);
  assert.equal(me.name, registration.name);
  assert.equal(me.phone, '0558318777');
  assert.equal(me.personaLabel, 'مستثمر — أبحث عن فرص');
  assert.equal(me.membership.status, 'active');
  assert.ok(me.membership.daysLeft > 300);

  const reused = await post('/api/auth/verify', { pendingToken, code: MOCK_CODE });
  assert.equal(reused.statusCode, 410);

  const meRes = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
  assert.equal(meRes.statusCode, 200);
  assert.equal(meRes.headers['cache-control'], 'no-store');
  assert.equal(meRes.json().me.email, registration.email);

  const patched = await app.inject({
    method: 'PATCH',
    url: '/api/me',
    headers: { authorization: `Bearer ${token}` },
    payload: { jobTitle: 'مدير استثمار', city: 'الرياض' },
  });
  assert.equal(patched.statusCode, 200, patched.body);
  assert.equal(patched.json().me.jobTitle, 'مدير استثمار');

  // M101: the mock's sign-up accounts are hub admins, so the DIRECT patch stays open for them —
  // exactly the owner's demo path (members get 403 persona_code_required and use the code flow).
  const directSwitch = await app.inject({
    method: 'PATCH',
    url: '/api/me',
    headers: { authorization: `Bearer ${token}` },
    payload: { persona: 'entrepreneur' },
  });
  assert.equal(directSwitch.statusCode, 200, directSwitch.body);
  assert.equal(directSwitch.json().me.persona, 'entrepreneur');
  assert.match(directSwitch.json().me.cardNumber, /^E-/);

  // The e-mailed-code flow (mock: the public test code stands in for the mail).
  const samePersona = await post('/api/me/persona/request', { persona: 'entrepreneur' }, token);
  assert.equal(samePersona.statusCode, 400);
  assert.equal(samePersona.json().error.code, 'persona_same');

  const requested = await post('/api/me/persona/request', { persona: 'investor' }, token);
  assert.equal(requested.statusCode, 200, requested.body);
  assert.equal(requested.json().days, 365);

  const wrongCode = await post('/api/me/persona/confirm', { code: '000000' }, token);
  assert.equal(wrongCode.statusCode, 400);
  assert.equal(wrongCode.json().error.code, 'persona_bad_code');

  const confirmed = await post('/api/me/persona/confirm', { code: MOCK_CODE }, token);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().me.persona, 'investor');
  assert.match(confirmed.json().me.cardNumber, /^I-/);

  // Admin exemption: no 30-day stamp — a new request right away still passes (members are
  // refused with persona_cooldown; see personaChange.test.ts for the window itself).
  const again = await post('/api/me/persona/request', { persona: 'entrepreneur' }, token);
  assert.equal(again.statusCode, 200, again.body);
  const confirmedAgain = await post('/api/me/persona/confirm', { code: MOCK_CODE }, token);
  assert.equal(confirmedAgain.statusCode, 200, confirmedAgain.body);
  assert.equal(confirmedAgain.json().me.persona, 'entrepreneur');

  const badPersona = await app.inject({
    method: 'PATCH',
    url: '/api/me',
    headers: { authorization: `Bearer ${token}` },
    payload: { persona: 'astronaut' },
  });
  assert.equal(badPersona.statusCode, 400);

  const loggedOut = await post('/api/auth/logout', {}, token);
  assert.equal(loggedOut.statusCode, 200);
  const afterLogout = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
  assert.equal(afterLogout.statusCode, 401);
});

test('login with e-mail or phone, wrong password rejected', async () => {
  const bad = await post('/api/auth/login', { login: registration.email, password: 'nope' });
  assert.equal(bad.statusCode, 401);
  assert.equal(bad.json().error.code, 'bad_login');

  const byEmail = await post('/api/auth/login', { login: registration.email, password: registration.password });
  assert.equal(byEmail.statusCode, 200, byEmail.body);
  assert.equal(byEmail.json().pending, false);

  const byPhone = await post('/api/auth/login', { login: '0558318777', password: registration.password });
  assert.equal(byPhone.statusCode, 200, byPhone.body);
  assert.equal(byPhone.json().me.id, byEmail.json().me.id);
});

// M126: a phone from ANY country signs in — the app sends the picked country, the server builds
// the international digits (the hub's own normaliser only understands Saudi local forms).
// Its own app instance: the shared one has already spent this IP's register/login budget.
test('world phone login: local digits + country, leading zero forgiven, intl form too', async () => {
  const built = await buildApp({ config, kv: new MemoryKV(), hub: new MockHubClient() });
  const send = (url: string, payload: Record<string, unknown>) => built.app.inject({ method: 'POST', url, payload });
  try {
    const world = { ...registration, name: 'منى من مصر', country: 'eg', phone: '1012345678', email: 'mona+eg@gmail.com' };
    const registered = await send('/api/auth/register', world);
    assert.equal(registered.statusCode, 200, registered.body);
    const verified = await send('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
    assert.equal(verified.statusCode, 200, verified.body);
    const id = verified.json().me.id;

    const byLocal = await send('/api/auth/login', { login: '1012345678', country: 'eg', password: world.password });
    assert.equal(byLocal.statusCode, 200, byLocal.body);
    assert.equal(byLocal.json().me.id, id);

    // The leading zero people habitually type is stripped (owner, 2026-10-25).
    const byZero = await send('/api/auth/login', { login: '01012345678', country: 'eg', password: world.password });
    assert.equal(byZero.statusCode, 200, byZero.body);
    assert.equal(byZero.json().me.id, id);

    // Typed internationally, the country pick does not matter.
    const byIntl = await send('/api/auth/login', { login: '+20 101 234 5678', country: 'sa', password: world.password });
    assert.equal(byIntl.statusCode, 200, byIntl.body);
    assert.equal(byIntl.json().me.id, id);

    const reset = await send('/api/auth/reset/request', { login: '01012345678', country: 'eg' });
    assert.equal(reset.statusCode, 200, reset.body);
    const confirmed = await send('/api/auth/reset/confirm', { login: '01012345678', country: 'eg', code: MOCK_CODE, password: 'newpass2' });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
  } finally {
    await built.app.close();
  }
});

test('unverified login returns a pending token; reset password works', async () => {
  const pendingReg = await post('/api/auth/register', {
    ...registration,
    email: 'noura@icloud.com',
    phone: '0501234567',
    name: 'نورة السالم',
    persona: 'entrepreneur',
  });
  assert.equal(pendingReg.statusCode, 200, pendingReg.body);

  const login = await post('/api/auth/login', { login: 'noura@icloud.com', password: registration.password });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().pending, true);
  assert.ok(login.json().pendingToken);

  const reset = await post('/api/auth/reset/request', { login: 'noura@icloud.com' });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().sentTo, 'no***@icloud.com');
  // M197: an unknown login is said out loud instead of a code that never comes.
  const unknown = await post('/api/auth/reset/request', { login: 'nobody-here@icloud.com' });
  assert.equal(unknown.statusCode, 404, unknown.body);
  assert.match(unknown.json().error.message, /لا يوجد حساب/);
  // The app translates no_account in both languages (M128); not_found would read as «العنصر غير موجود».
  assert.equal(unknown.json().error.code, 'no_account');
  const confirmed = await post('/api/auth/reset/confirm', { login: 'noura@icloud.com', code: MOCK_CODE, password: 'newpass1' });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
});

test('validation and rejected inputs use Arabic messages', async () => {
  const badPhone = await post('/api/auth/register', { ...registration, email: 'x@gmail.com', phone: '12' });
  assert.equal(badPhone.statusCode, 400);
  assert.match(badPhone.json().error.message, /[؀-ۿ]/);

  // M64 (world list): any valid address registers now; only a malformed one is rejected.
  const badEmail = await post('/api/auth/register', { ...registration, email: 'not-an-email', phone: '0551112222' });
  assert.equal(badEmail.statusCode, 400);
  assert.match(badEmail.json().error.message, /[؀-ۿ]/);

  const duplicate = await post('/api/auth/register', registration);
  assert.equal(duplicate.statusCode, 409);

  // M64: a non-GCC country passes the generic world rule (Egypt, with and without the leading zero).
  const world = await post('/api/auth/register', { ...registration, country: 'eg', phone: '01012345678', email: 'world@yahoo.com' });
  assert.equal(world.statusCode, 200, world.body);
  assert.equal(world.json().pending, true);

  const noToken = await app.inject({ method: 'GET', url: '/api/me' });
  assert.equal(noToken.statusCode, 401);
  const badToken = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer nope' } });
  assert.equal(badToken.statusCode, 401);
});

// M69: «فرد / شركة» on registration — a company account requires the company name and keeps it.
// Its own app instance: the shared one has already spent the register rate-limit budget of this IP.
test('member type: company requires a name, individual is the default', async () => {
  const built = await buildApp({ config, kv: new MemoryKV(), hub: new MockHubClient() });
  const send = (url: string, payload: Record<string, unknown>) => built.app.inject({ method: 'POST', url, payload });
  try {
    const base = { ...registration, phone: '0553334444', email: 'm69@gmail.com' };

    const missingName = await send('/api/auth/register', { ...base, memberType: 'company' });
    assert.equal(missingName.statusCode, 400);
    assert.match(missingName.json().error.message, /اسم الشركة/);

    const badType = await send('/api/auth/register', { ...base, memberType: 'partnership', companyName: 'شركة التقنية' });
    assert.equal(badType.statusCode, 400);

    const company = await send('/api/auth/register', { ...base, memberType: 'company', companyName: 'شركة الرؤية للاستثمار' });
    assert.equal(company.statusCode, 200, company.body);
    const verified = await send('/api/auth/verify', { pendingToken: company.json().pendingToken, code: MOCK_CODE });
    assert.equal(verified.statusCode, 200, verified.body);
    assert.equal(verified.json().me.memberType, 'company');
    assert.equal(verified.json().me.company, 'شركة الرؤية للاستثمار');

    // No memberType in the payload = «فرد», and the company name is ignored when sent anyway.
    const individual = await send('/api/auth/register', { ...registration, phone: '0555556666', email: 'm69b@gmail.com', companyName: 'تُتجاهل' });
    assert.equal(individual.statusCode, 200, individual.body);
    const soloVerified = await send('/api/auth/verify', { pendingToken: individual.json().pendingToken, code: MOCK_CODE });
    assert.equal(soloVerified.statusCode, 200, soloVerified.body);
    assert.equal(soloVerified.json().me.memberType, 'individual');
    assert.equal(soloVerified.json().me.company, '');
  } finally {
    await built.app.close();
  }
});

test('delete account needs the password and schedules 30 days ahead (M117: never instant)', async () => {
  const login = await post('/api/auth/login', { login: registration.email, password: registration.password });
  const { token } = login.json();
  const wrong = await app.inject({ method: 'DELETE', url: '/api/me', headers: { authorization: `Bearer ${token}` }, payload: { password: 'nope' } });
  assert.equal(wrong.statusCode, 403);
  assert.equal(wrong.json().error.code, 'bad_password');
  const deleted = await app.inject({
    method: 'DELETE',
    url: '/api/me',
    headers: { authorization: `Bearer ${token}` },
    payload: { password: registration.password },
  });
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(deleted.json().daysLeft, 30);
  // The account lives through the grace window: signing in still works.
  const still = await post('/api/auth/login', { login: registration.email, password: registration.password });
  assert.equal(still.statusCode, 200, still.body);
});

test('the owner can still close test registration and restore the admins-only preview', async () => {
  const liveConfig = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'live', HUB_SITE_KEY: 'x'.repeat(40), HUB_ALLOW_TEST_REGISTRATION: '0', AUTH_ADMIN_ONLY: '1' });
  const hub = new MockHubClient();
  const original = hub.call.bind(hub);
  // Pretend the hub says this account is not an admin.
  hub.call = async (op, body) => {
    const result = await original(op, body);
    if (result.contact) result.contact.is_admin = 0;
    return result;
  };
  const built = await buildApp({ config: liveConfig, kv: new MemoryKV(), hub });
  try {
    const closed = await built.app.inject({ method: 'POST', url: '/api/auth/register', payload: registration });
    assert.equal(closed.statusCode, 403);
    assert.equal(closed.json().error.code, 'registration_closed');

    // Seed an account directly in the fake hub, then try to sign in as a non-admin.
    await original('register', { ...registration, uuid: 'seed-uuid-1', job_title: '' });
    await original('verify', { uuid: 'seed-uuid-1', code: MOCK_CODE });
    const login = await built.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: registration.email, password: registration.password },
    });
    assert.equal(login.statusCode, 403);
    assert.equal(login.json().error.code, 'admin_only');
  } finally {
    await built.app.close();
  }
});

// M242 (complaint «إيميل صحيح ويترفض»): what the member reads when a correct address is refused.

/** A hub whose answers a test scripts per operation; everything else goes to the mock hub. */
class ScriptedHub implements HubClient {
  readonly mode = 'mock' as const;
  private readonly inner = new MockHubClient();
  script: Partial<Record<HubOp, (body: HubBody) => HubResponse | Promise<HubResponse>>> = {};
  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    const scripted = this.script[op];
    return scripted ? scripted(body) : this.inner.call(op, body);
  }
}
const known = (hasAccount: 0 | 1) => ({ id: 77, name: 'هيفاء الغامدي', has_account: hasAccount }) as unknown as HubContact;
const KNOWN_BY_EMAIL = 'بريدك معروف لدى النادي، لكن لم يُنشأ له حساب في التطبيق بعد — أنشئ حسابك بالبريد نفسه ورقم جوالك';

test('sign-in tells «known to the club, no app account» apart from a wrong password; the reset keeps its own answers', async () => {
  const hub = new ScriptedHub();
  const built = await buildApp({ config, kv: new MemoryKV(), hub });
  const call = (url: string, payload: Record<string, unknown>) => built.app.inject({ method: 'POST', url, payload });
  const signIn = () => call('/api/auth/login', { login: 'haifa.alghamdi@gmail.com', password: 'whatever1' });
  try {
    hub.script.login = () => {
      throw new HubError('bad_login', 'البريد/الجوال أو كلمة المرور غير صحيحة', 401);
    };

    // Nobody the hub knows: the M128 answer.
    hub.script.member_status = () => ({ ok: true, found: false });
    const nobody = await signIn();
    assert.deepEqual([nobody.statusCode, nobody.json().error.code], [404, 'no_account']);
    assert.match(nobody.json().error.message, /لا يوجد حساب مسجل/);

    // A contact row without a password (paid on the website, an earlier lead).
    hub.script.member_status = () => ({ ok: true, found: true, contact: known(0) });
    const contactOnly = await signIn();
    assert.deepEqual([contactOnly.statusCode, contactOnly.json().error.code], [404, 'no_account'], 'the code every bundle carries to the sign-up screen');
    assert.equal(contactOnly.json().error.message, KNOWN_BY_EMAIL);

    // A name on the paid-members list only.
    hub.script.member_status = () => ({ ok: true, found: true, source: 'members_list' });
    const listOnly = await signIn();
    assert.deepEqual([listOnly.statusCode, listOnly.json().error.message], [404, KNOWN_BY_EMAIL]);

    // The same by mobile number: the sentence speaks of the number.
    hub.script.member_status = (body) => {
      assert.match(String(body.phone), /^\d{8,15}$/);
      return { ok: true, found: true, contact: known(0) };
    };
    const byPhone = await call('/api/auth/login', { login: '0558318701', password: 'whatever1' });
    assert.equal(byPhone.statusCode, 404);
    assert.match(byPhone.json().error.message, /^رقم جوالك معروف لدى النادي/);

    // A real app account: the password IS wrong, and the hub's sentence stands.
    hub.script.member_status = () => ({ ok: true, found: true, contact: known(1) });
    const wrong = await signIn();
    assert.deepEqual([wrong.statusCode, wrong.json().error.code], [401, 'bad_login']);

    // Any doubt — a hub that fails, or an old hub that says nothing — keeps the wrong-password answer.
    hub.script.member_status = () => {
      throw new HubError('hub_unreachable', 'تعذّر الاتصال بالنادي الآن، حاول بعد قليل', 502);
    };
    assert.equal((await signIn()).json().error.code, 'bad_login');
    hub.script.member_status = () => ({ ok: true });
    assert.equal((await signIn()).json().error.code, 'bad_login');

    // The new answer lives on the sign-in route only: the password reset keeps the hub's own answer for everyone
    // and asks the hub nothing more about the address (no state a stranger could read from it).
    hub.script.reset_request = () => {
      throw new HubError('not_found', 'لا يوجد حساب بهذا البريد', 404);
    };
    let lookups = 0;
    hub.script.member_status = () => {
      lookups += 1;
      return { ok: true, found: true, contact: known(0) };
    };
    const reset = await call('/api/auth/reset/request', { login: 'haifa.alghamdi@gmail.com' });
    assert.deepEqual([reset.statusCode, reset.json().error.code, reset.json().error.message], [404, 'no_account', 'لا يوجد حساب بهذا البريد']);
    hub.script.reset_confirm = () => {
      throw new HubError('not_found', 'لا يوجد حساب بهذا البريد', 404);
    };
    const confirm = await call('/api/auth/reset/confirm', { login: 'haifa.alghamdi@gmail.com', code: '1234', password: 'newpass1' });
    assert.deepEqual([confirm.statusCode, confirm.json().error.code, confirm.json().error.message], [404, 'no_account', 'لا يوجد حساب بهذا البريد']);
    assert.equal(lookups, 0, 'the reset never looks the address up');
  } finally {
    await built.app.close();
  }
});

test('sign-up says which detail is already taken: the e-mail or the mobile number', async () => {
  const hub = new ScriptedHub();
  const built = await buildApp({ config, kv: new MemoryKV(), hub });
  const HUB_SENTENCE = 'عندك حساب بهذا البريد أو الجوال — سجّل الدخول';
  const signUp = () => built.app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...registration, name: 'هيفاء الغامدي', email: 'haifa.new@gmail.com', phone: '0558318702' } });
  let taken = { email: 0 as 0 | 1 | null, phone: 0 as 0 | 1 | null };
  try {
    hub.script.register = () => {
      throw new HubError('exists', HUB_SENTENCE, 409);
    };
    hub.script.member_status = (body) => {
      const hit = 'email' in body ? taken.email : taken.phone;
      return hit === null ? { ok: true, found: false } : { ok: true, found: true, contact: known(hit) };
    };

    taken = { email: null, phone: 1 };
    const phone = await signUp();
    assert.deepEqual([phone.statusCode, phone.json().error.code], [409, 'exists'], 'the code is unchanged for every bundle');
    assert.equal(phone.json().error.message, 'رقم الجوال هذا مسجّل لحساب آخر — سجّل الدخول برقم الجوال، أو استخدم «نسيت كلمة المرور»');

    taken = { email: 1, phone: null };
    const email = await signUp();
    assert.deepEqual([email.statusCode, email.json().error.message], [409, 'هذا البريد مسجّل لحساب آخر — سجّل الدخول، أو استخدم «نسيت كلمة المرور»']);

    // Only an app account counts: an address the club merely knows is not «taken».
    taken = { email: 0, phone: 1 };
    assert.match((await signUp()).json().error.message, /^رقم الجوال هذا مسجّل/);

    // Both, or a lookup that fails: the hub's own sentence stands.
    taken = { email: 1, phone: 1 };
    assert.equal((await signUp()).json().error.message, HUB_SENTENCE);
    hub.script.member_status = () => {
      throw new HubError('hub_unreachable', 'تعذّر الاتصال بالنادي الآن، حاول بعد قليل', 502);
    };
    const unsure = await signUp();
    assert.deepEqual([unsure.statusCode, unsure.json().error.code, unsure.json().error.message], [409, 'exists', HUB_SENTENCE]);
  } finally {
    await built.app.close();
  }
});

// The 37 inputs of the investigation: 17 every layer accepted, 16 the app and the server passed and the hub
// refused, 4 that are malformed. `null` = refused with the «write a correct e-mail» sentence.
const EMAIL_TABLE: [label: string, typed: string, cleaned: string | null][] = [
  ['plain', 'user@gmail.com', 'user@gmail.com'],
  ['trailing space', 'user@gmail.com ', 'user@gmail.com'],
  ['leading space', ' user@gmail.com', 'user@gmail.com'],
  ['capitals', 'User.Name@Gmail.COM', 'user.name@gmail.com'],
  ['plus tag', 'Name+tag@gmail.com', 'name+tag@gmail.com'],
  ['dots in the name', 'first.m.last@gmail.com', 'first.m.last@gmail.com'],
  ['long top-level domain', 'ceo@company.technology', 'ceo@company.technology'],
  ['.sa', 'user@domain.sa', 'user@domain.sa'],
  ['.com.sa', 'user@domain.com.sa', 'user@domain.com.sa'],
  ['digits in the domain', 'user@mail2web4u.com', 'user@mail2web4u.com'],
  ['hyphen in the domain', 'user@my-company.co', 'user@my-company.co'],
  ['underscore and digits', 'user_name99@outlook.sa', 'user_name99@outlook.sa'],
  ['apostrophe', "o'brien@gmail.com", "o'brien@gmail.com"],
  ['shortest', 'a@b.co', 'a@b.co'],
  ['no-break space after', 'user@gmail.com ', 'user@gmail.com'],
  ['byte-order mark before', '﻿user@gmail.com', 'user@gmail.com'],
  ['newline after', 'user@gmail.com\n', 'user@gmail.com'],
  ['Arabic-Indic digits', 'user٢٠٢٦@gmail.com', 'user2026@gmail.com'],
  ['Persian digits', 'user۲۰۲۶@gmail.com', 'user2026@gmail.com'],
  ['left-to-right mark before', '‎user@gmail.com', 'user@gmail.com'],
  ['right-to-left mark after', 'user@gmail.com‏', 'user@gmail.com'],
  ['Arabic letter mark before', '؜user@gmail.com', 'user@gmail.com'],
  ['embedding marks around', '‪user@gmail.com‬', 'user@gmail.com'],
  ['isolate marks around', '⁨user@gmail.com⁩', 'user@gmail.com'],
  ['zero-width space after', 'user@gmail.com​', 'user@gmail.com'],
  ['trailing full stop', 'user@gmail.com.', 'user@gmail.com'],
  ['trailing comma', 'user@gmail.com,', 'user@gmail.com'],
  ['trailing Arabic comma', 'user@gmail.com،', 'user@gmail.com'],
  ['mailto:', 'mailto:user@gmail.com', 'user@gmail.com'],
  ['angle brackets', '<user@gmail.com>', 'user@gmail.com'],
  ['double dot in the domain', 'user@gmail..com', null],
  ['typographic apostrophe', 'o’brien@gmail.com', null],
  ['Arabic-script domain', 'user@موقع.com', null],
  ['space inside the name', 'user @gmail.com', null],
  ['space inside the domain', 'user@gmail. com', null],
  ['full-width at sign', 'user＠gmail.com', null],
  ['one-letter ending', 'a@b.c', null],
];

test('an address is cleaned one way everywhere: the 37 inputs', () => {
  assert.equal(EMAIL_TABLE.length, 37);
  for (const [label, typed, cleaned] of EMAIL_TABLE) {
    assert.equal(normEmail(typed), cleaned ?? '', label);
    // Sign-in and reset go through normLogin: the same clean address, or the text as typed for the hub to refuse.
    if (cleaned) assert.equal(normLogin(typed), cleaned, `${label} (sign-in)`);
    else assert.equal(isEmailShape(cleanEmail(typed)), false, `${label} (shape)`);
  }
  // Cleaning never invents an address out of something else.
  assert.equal(normEmail('0558318777'), '');
  assert.equal(normEmail(''), '');
});

test('sign-up stores the cleaned address, sign-in finds it however it is typed, a malformed one is named', async () => {
  const built = await buildApp({ config, kv: new MemoryKV(), hub: new MockHubClient() });
  const call = (method: 'POST' | 'PATCH', url: string, payload: Record<string, unknown>, token?: string) =>
    built.app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
  // As a member pastes it from a chat on an Arabic keyboard: a direction mark, Arabic digits, capitals, a full stop.
  const pasted = '‏Mansour.AlHarbi٢٠٢٦@Gmail.com.';
  const clean = 'mansour.alharbi2026@gmail.com';
  try {
    const registered = await call('POST', '/api/auth/register', { ...registration, name: 'منصور الحربي', phone: '0558318703', email: pasted });
    assert.equal(registered.statusCode, 200, registered.body);
    assert.equal(registered.json().email, clean);
    const verified = await call('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
    assert.equal(verified.statusCode, 200, verified.body);
    assert.equal(verified.json().me.email, clean);

    for (const typed of [pasted, clean, ` <${clean.toUpperCase()}> `, `mailto:${clean}`]) {
      const signedIn = await call('POST', '/api/auth/login', { login: typed, password: registration.password });
      assert.equal(signedIn.statusCode, 200, `${JSON.stringify(typed)} ${signedIn.body}`);
      assert.equal(signedIn.json().me.id, verified.json().me.id);
    }
    assert.equal((await call('POST', '/api/auth/reset/request', { login: pasted })).statusCode, 200);

    // A malformed address is refused here, with a sentence that says what is wrong (the hub said «required»).
    for (const typed of ['user@gmail..com', 'not-an-email', 'o’brien@gmail.com']) {
      const refused = await call('POST', '/api/auth/register', { ...registration, name: 'منصور الحربي', phone: '0558318704', email: typed });
      assert.deepEqual([refused.statusCode, refused.json().error.code, refused.json().error.message], [400, 'invalid', 'اكتب بريدًا إلكترونيًا صحيحًا (مثل name@example.com)'], typed);
    }
    const empty = await call('POST', '/api/auth/register', { ...registration, name: 'منصور الحربي', phone: '0558318704', email: ' ‏ ' });
    assert.deepEqual([empty.statusCode, empty.json().error.message], [400, 'البريد الإلكتروني مطلوب']);

    // The profile's contact e-mail is cleaned the same way.
    const token = verified.json().token as string;
    const saved = await call('PATCH', '/api/me', { contactEmail: '‎Mansour.Work@Company.SA,' }, token);
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().me.contactEmail, 'mansour.work@company.sa');
    const odd = await call('PATCH', '/api/me', { contactEmail: 'mansour@company' }, token);
    assert.deepEqual([odd.statusCode, odd.json().error.code], [400, 'invalid']);
  } finally {
    await built.app.close();
  }
});

test('a refusal leaves one log line that says what kind of text it was, and nothing of the text', async () => {
  const hub = new ScriptedHub();
  const built = await buildApp({ config, kv: new MemoryKV(), hub });
  const lines: Record<string, unknown>[] = [];
  const log = built.app.log as unknown as { info: (line: unknown, text?: string) => void };
  const keep = log.info.bind(built.app.log);
  log.info = (line, text) => {
    if (text === 'auth refusal') lines.push(line as Record<string, unknown>);
    else keep(line, text);
  };
  const call = (url: string, payload: Record<string, unknown>, platform: string) => built.app.inject({ method: 'POST', url, payload, headers: { 'x-app-platform': platform } });
  const typedEmail = '‏Turki.Subaie١٩٨٧@Gmail.com.';
  const typedPhone = '0558318705';
  try {
    hub.script.login = () => {
      throw new HubError('bad_login', 'البريد/الجوال أو كلمة المرور غير صحيحة', 401);
    };
    hub.script.member_status = () => ({ ok: true, found: true, contact: known(0) });
    await call('/api/auth/login', { login: typedEmail, password: 'whatever1' }, 'ios');
    hub.script.member_status = () => ({ ok: true, found: true, contact: known(1) });
    await call('/api/auth/login', { login: typedPhone, password: 'whatever1' }, 'android');
    await call('/api/auth/register', { ...registration, name: 'تركي السبيعي', phone: typedPhone, email: 'turki.subaie1987@gmail..com' }, 'android');
    hub.script.reset_request = () => {
      throw new HubError('not_found', 'لا يوجد حساب بهذا البريد', 404);
    };
    hub.script.member_status = () => ({ ok: true, found: false });
    await call('/api/auth/reset/request', { login: typedEmail }, 'ios');

    assert.deepEqual(
      lines.map((line) => [line.route, line.code, line.platform, line.accountState ?? null]),
      [
        ['login', 'no_account', 'app-ios', 'passwordless'],
        ['login', 'bad_login', 'app-android', 'account'],
        ['register', 'invalid', 'app-android', null],
        // The reset route does not look the address up, so its line carries no account state.
        ['reset', 'no_account', 'app-ios', null],
      ],
    );
    assert.deepEqual(
      { looksEmail: lines[0]?.looksEmail, hadFormatChar: lines[0]?.hadFormatChar, hadNonAsciiDigit: lines[0]?.hadNonAsciiDigit, hadTrailingPunct: lines[0]?.hadTrailingPunct, hadUpper: lines[0]?.hadUpper },
      { looksEmail: true, hadFormatChar: true, hadNonAsciiDigit: true, hadTrailingPunct: true, hadUpper: true },
    );
    assert.deepEqual([lines[1]?.looksEmail, lines[1]?.hadFormatChar, lines[1]?.hadUpper], [false, false, false]);
    // Nothing of the address or the number: no «@», no name, no digit of either.
    const written = JSON.stringify(lines);
    assert.ok(!written.includes('@'));
    assert.ok(!/turki|subaie|gmail/i.test(written));
    assert.ok(!/\d/.test(written), written);
    for (const line of lines) {
      for (const [key, value] of Object.entries(line)) {
        assert.ok(typeof value === 'boolean' || ['route', 'code', 'platform', 'accountState'].includes(key), `${key} is not a flag`);
      }
    }
  } finally {
    await built.app.close();
  }
});
