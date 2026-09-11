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
  assert.equal(body.adminOnly, true);
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
  assert.equal(me.personaLabel, 'مستثمر — أبحث عن فرص شراكة واعدة');
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

  const badDomain = await post('/api/auth/register', { ...registration, email: 'x@yahoo.com', phone: '0551112222' });
  assert.equal(badDomain.statusCode, 400);
  assert.equal(badDomain.json().error.code, 'email_domain');

  const duplicate = await post('/api/auth/register', registration);
  assert.equal(duplicate.statusCode, 409);

  const noToken = await app.inject({ method: 'GET', url: '/api/me' });
  assert.equal(noToken.statusCode, 401);
  const badToken = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer nope' } });
  assert.equal(badToken.statusCode, 401);
});

test('delete account needs the password and ends the session', async () => {
  const login = await post('/api/auth/login', { login: registration.email, password: registration.password });
  const { token } = login.json();
  const wrong = await app.inject({ method: 'DELETE', url: '/api/me', headers: { authorization: `Bearer ${token}` }, payload: { password: 'nope' } });
  assert.equal(wrong.statusCode, 401);
  const deleted = await app.inject({
    method: 'DELETE',
    url: '/api/me',
    headers: { authorization: `Bearer ${token}` },
    payload: { password: registration.password },
  });
  assert.equal(deleted.statusCode, 200, deleted.body);
  const gone = await post('/api/auth/login', { login: registration.email, password: registration.password });
  assert.equal(gone.statusCode, 401);
});

test('test environment closes registration on the live hub and admits admins only', async () => {
  const liveConfig = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'live', HUB_SITE_KEY: 'x'.repeat(40) });
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
