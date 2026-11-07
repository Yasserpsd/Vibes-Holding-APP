import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signData } from 'node:crypto';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { MemoryKV } from './store.js';

// M211 (owner, 2026-11-07): «ما يمشي التسجيل بدون تأكيد رقم واتس اب». The number is confirmed on the form, before any account
// exists; Google and Apple included. An older bundle keeps the hub's WhatsApp-only code, a fresh install reopens the app.
const GOOGLE_AUD = 'test-client.apps.googleusercontent.com';
const KID = 'm211-test-key';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: KID, alg: 'RS256', use: 'sig' };
const b64u = (value: string): string => Buffer.from(value).toString('base64url');
function googleToken(email: string): string {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ iss: 'https://accounts.google.com', aud: GOOGLE_AUD, sub: `g-${email}`, email, email_verified: true, name: 'سالم القحطاني', exp: now + 600, iat: now }));
  return `${head}.${body}.${signData('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

const NEW_BUNDLE = 'name,phone,persona,jobTitle,contactEmail,phoneCode,waCodes,phoneFirst';
const OLD_BUNDLE = 'name,phone,persona,jobTitle,contactEmail,phoneCode,waCodes';
const base = {
  LOG_LEVEL: 'silent',
  HUB_MODE: 'mock',
  NEWS_REFRESH_MINUTES: '0',
  VIDEOS_REFRESH_MINUTES: '0',
  PHONE_CODE_MODE: 'on',
  PHONE_PROOF_DAILY_CAP: '40',
  GOOGLE_CLIENT_IDS: GOOGLE_AUD,
  WHATSAPP_TOKEN: 'test-token-value-000000',
  WHATSAPP_PHONE_ID: '11111',
  WHATSAPP_WABA_ID: '22222',
};

const wa = { codes: [] as { to: string; code: string }[], refuse: false };
const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
  const target = String(url);
  if (target.includes('oauth2/v3/certs')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (target.includes('message_templates')) {
    return new Response(JSON.stringify({ data: [{ name: 'club_login_code', language: 'ar', status: 'APPROVED', category: 'AUTHENTICATION', components: [{ type: 'BODY', text: 'code {{1}}' }] }] }), { status: 200 });
  }
  if (target.includes('/messages')) {
    if (wa.refuse) return new Response(JSON.stringify({ error: { code: 131026, message: 'undeliverable' } }), { status: 400 });
    const body = JSON.parse(String(init?.body)) as { to: string; template: { components: { type: string; parameters: { text: string }[] }[] } };
    wa.codes.push({ to: body.to, code: body.template.components.find((part) => part.type.toLowerCase() === 'body')?.parameters[0]?.text ?? '' });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.m211.${wa.codes.length}` }] }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
}) as typeof fetch;

const hub = new MockHubClient();
let built: BuiltApp;
let app: BuiltApp['app'];
let caller = 0;
const call = (url: string, payload: Record<string, unknown>, gate: string | null = NEW_BUNDLE) =>
  app.inject({ method: 'POST', url, payload, remoteAddress: `10.11.0.${(caller = (caller % 250) + 1)}`, headers: gate ? { 'x-app-gate': gate } : {} });

let seq = 0;
const nextPhone = () => `5587${String(10000 + (seq += 1))}`;
const form = (phone: string, extra: Record<string, unknown> = {}) => ({ name: 'صالح الغامدي', country: 'sa', phone, email: `m211.${(seq += 1)}@gmail.com`, password: 'secret123', persona: 'investor', jobTitle: 'مدير تطوير أعمال', ...extra });

async function prove(phone: string): Promise<string> {
  wa.codes.length = 0;
  const started = await call('/api/auth/phone-proof/start', { phone, country: 'sa' });
  assert.equal(started.statusCode, 200, started.body);
  const code = wa.codes.pop()?.code ?? '';
  assert.match(code, /^\d{4}$/);
  const confirmed = await call('/api/auth/phone-proof/confirm', { stepToken: started.json().stepToken, code });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  return confirmed.json().proof as string;
}

before(async () => {
  built = await buildApp({ config: loadConfig(base), kv: new MemoryKV(), hub, fetchImpl });
  app = built.app;
});

after(async () => {
  await built.app.close();
});

test('m211: the config tells the form to confirm the number', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/config' });
  assert.equal(res.json().phoneProofRequired, true);
});

test('m211: no sign-up without a proof, and nothing reaches the hub', async () => {
  const phone = nextPhone();
  const res = await call('/api/auth/register', form(phone));
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'phone_proof_required');
  // The number is still free: no half account was left behind.
  assert.equal((await call('/api/auth/phone-proof/start', { phone, country: 'sa' })).statusCode, 200);
});

test('m211: a proven number opens the account at once, verified, with one WhatsApp message only', async () => {
  const phone = nextPhone();
  const phoneProof = await prove(phone);
  wa.codes.length = 0;
  const res = await call('/api/auth/register', form(phone, { phoneProof }));
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(res.json().token);
  assert.equal(res.json().me.phoneVerified, true);
  assert.equal(wa.codes.length, 0);
});

test('m211: the proof belongs to one number and works once', async () => {
  const phone = nextPhone();
  const phoneProof = await prove(phone);
  const other = await call('/api/auth/register', form(nextPhone(), { phoneProof }));
  assert.equal(other.json().error.code, 'phone_proof_required');
  assert.equal((await call('/api/auth/register', form(phone, { phoneProof }))).statusCode, 200);
  const again = await call('/api/auth/register', form(nextPhone(), { phoneProof }));
  assert.equal(again.json().error.code, 'phone_proof_required');
});

test('m211: a wrong code gives no proof', async () => {
  const phone = nextPhone();
  wa.codes.length = 0;
  const started = await call('/api/auth/phone-proof/start', { phone, country: 'sa' });
  const code = wa.codes.pop()?.code ?? '';
  const wrong = await call('/api/auth/phone-proof/confirm', { stepToken: started.json().stepToken, code: code === '1111' ? '2222' : '1111' });
  assert.equal(wrong.statusCode, 400);
  assert.equal(wrong.json().proof, undefined);
});

test('m211: a number with an account is told so before any paid message leaves', async () => {
  const phone = nextPhone();
  const phoneProof = await prove(phone);
  await call('/api/auth/register', form(phone, { phoneProof }));
  wa.codes.length = 0;
  const res = await call('/api/auth/phone-proof/start', { phone, country: 'sa' });
  assert.equal(res.statusCode, 409);
  assert.equal(wa.codes.length, 0);
});

test('m211: WhatsApp refusing the code never falls to the e-mail', async () => {
  wa.refuse = true;
  const res = await call('/api/auth/phone-proof/start', { phone: nextPhone(), country: 'sa' });
  wa.refuse = false;
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().stepToken, undefined);
});

test('m211: one number cannot buy endless messages', async () => {
  const phone = nextPhone();
  const codes = [];
  for (let index = 0; index < 8; index += 1) codes.push((await call('/api/auth/phone-proof/start', { phone, country: 'sa' })).statusCode);
  assert.ok(codes.includes(429), codes.join(','));
});

test('m211: an older bundle keeps the code screen, and only the code opens the account', async () => {
  const res = await call('/api/auth/register', form(nextPhone()), OLD_BUNDLE);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().pending, true);
  assert.equal(res.json().token, undefined);
  const verified = await call('/api/auth/verify', { pendingToken: res.json().pendingToken, code: MOCK_CODE }, OLD_BUNDLE);
  assert.equal(verified.statusCode, 200, verified.body);
});

test('m211: a first Google sign-in creates nothing until its number is proven', async () => {
  const email = `m211.social.${(seq += 1)}@gmail.com`;
  const first = await call('/api/auth/social', { provider: 'google', token: googleToken(email) });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().phoneFirst, true);
  assert.equal(first.json().token, undefined);
  // M212: the sign-up form opens with the provider's name and e-mail.
  assert.equal(first.json().email, email);
  assert.ok(first.json().name);

  const noProof = await call('/api/auth/social/complete', { signupToken: first.json().signupToken, phoneProof: 'x'.repeat(40) });
  assert.equal(noProof.json().error.code, 'phone_proof_required');

  const phone = nextPhone();
  const phoneProof = await prove(phone);
  // M212: the form's own fields come with the proof and land on the new account.
  const done = await call('/api/auth/social/complete', { signupToken: first.json().signupToken, phoneProof, name: 'سعود الحربي', persona: 'investor', jobTitle: 'مدير استثمار' });
  assert.equal(done.statusCode, 200, done.body);
  assert.ok(done.json().token);
  assert.equal(done.json().created, true);
  assert.equal(done.json().me.phoneVerified, true);
  assert.ok(String(done.json().me.phone).endsWith(phone));
  assert.equal(done.json().me.name, 'سعود الحربي');
  assert.equal(done.json().me.persona, 'investor');
  assert.equal(done.json().me.jobTitle, 'مدير استثمار');

  // The account now exists: the next Google sign-in is an ordinary one, with the WhatsApp code of every sign-in.
  const next = await call('/api/auth/social', { provider: 'google', token: googleToken(email) });
  assert.equal(next.json().phoneFirst, undefined);
  assert.equal(next.json().phoneStep, true);
});

test('m211: a first install on the embedded bundle is told to reopen the app, no account appears', async () => {
  const email = `m211.reopen.${(seq += 1)}@gmail.com`;
  const res = await call('/api/auth/social', { provider: 'google', token: googleToken(email) }, OLD_BUNDLE);
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'phone_first_reopen');
  assert.equal((await call('/api/auth/social', { provider: 'google', token: googleToken(email) })).json().phoneFirst, true);
});
