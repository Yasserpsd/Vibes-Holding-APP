import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { ensureMembershipSeed } from '../content/membership.js';
import { MOCK_CODE, MockHubClient } from '../hub/mock.js';
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

test('unverified login returns a pending token; reset password works', async () => {
  const pendingReg = await post('/api/auth/register', {
    ...registration,
    email: 'noura@icloud.com',
    phone: '0501234567',
    name: 'نورة',
    persona: 'entrepreneur',
  });
  assert.equal(pendingReg.statusCode, 200, pendingReg.body);

  const login = await post('/api/auth/login', { login: 'noura@icloud.com', password: registration.password });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().pending, true);
  assert.ok(login.json().pendingToken);

  const reset = await post('/api/auth/reset/request', { login: 'noura@icloud.com' });
  assert.equal(reset.statusCode, 200);
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
