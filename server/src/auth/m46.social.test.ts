import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as signData, type KeyObject } from 'node:crypto';
import { after, before, test } from 'node:test';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { ensureMembershipSeed } from '../content/membership.js';
import { MockHubClient } from '../hub/mock.js';
import { MemoryKV } from '../store.js';

/**
 * M46: Google / Apple sign-in. The tokens are real RS256 JWTs signed with a test key; the
 * verifier fetches "Google's" and "Apple's" JWKS from the injected fetch, so the whole path
 * (signature, issuer, audience, expiry, e-mail) runs exactly as in production.
 */
const GOOGLE_AUD = 'test-client.apps.googleusercontent.com';
const APPLE_AUD = 'com.vibesholding.club';
const KID = 'm46-test-key';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: KID, alg: 'RS256', use: 'sig' };

const b64u = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

function signToken(payload: Record<string, unknown>, key: KeyObject = privateKey, kid = KID): string {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const signature = signData('RSA-SHA256', Buffer.from(`${head}.${body}`), key);
  return `${head}.${body}.${signature.toString('base64url')}`;
}

const now = (): number => Math.floor(Date.now() / 1000);

function googleToken(email: string, extra: Record<string, unknown> = {}): string {
  return signToken({ iss: 'https://accounts.google.com', aud: GOOGLE_AUD, sub: `g-${email}`, email, email_verified: true, name: 'عضو جوجل', exp: now() + 600, iat: now(), ...extra });
}

function appleToken(email: string, extra: Record<string, unknown> = {}): string {
  return signToken({ iss: 'https://appleid.apple.com', aud: APPLE_AUD, sub: `a-${email}`, email, email_verified: 'true', exp: now() + 600, iat: now(), ...extra });
}

/** Serves the test JWKS for both providers; everything else must not be called in these tests. */
const fetchImpl: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes('googleapis.com/oauth2/v3/certs') || url.includes('appleid.apple.com/auth/keys')) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
};

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', GOOGLE_CLIENT_IDS: GOOGLE_AUD, APPLE_APP_IDS: APPLE_AUD });
let app: Awaited<ReturnType<typeof buildApp>>['app'];

const post = async (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/auth/social', payload });

before(async () => {
  await ensureMembershipSeed(kv);
  const built = await buildApp({ config, kv, hub: new MockHubClient(), fetchImpl });
  app = built.app;
});

after(async () => {
  await app.close();
});

test('auth config announces the configured social providers', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/config' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().social, { google: true, apple: true });
});

test('google sign-in creates a verified account and signs in instantly', async () => {
  const res = await post({ provider: 'google', token: googleToken('new.member@gmail.com') });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.pending, false);
  assert.ok(body.token.length >= 32);
  assert.equal(body.me.email, 'new.member@gmail.com');
  assert.equal(body.me.name, 'عضو جوجل');
  assert.equal(body.me.verified, true);

  // The session works like any other — fresh=1 skips the me-cache, so has_account is really checked.
  const me = await app.inject({ method: 'GET', url: '/api/me?fresh=1', headers: { authorization: `Bearer ${body.token}` } });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().me.email, 'new.member@gmail.com');
});

test('a second google sign-in finds the same account, never a duplicate', async () => {
  const first = await post({ provider: 'google', token: googleToken('same.person@gmail.com') });
  const second = await post({ provider: 'google', token: googleToken('same.person@gmail.com') });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.json().me.id, second.json().me.id);
});

test('apple sign-in works and takes the name from the request body (Apple sends none)', async () => {
  const res = await post({ provider: 'apple', token: appleToken('apple.user@icloud.com'), name: 'عضو أبل' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().me.name, 'عضو أبل');
});

test('a token for another audience is refused', async () => {
  const res = await post({ provider: 'google', token: googleToken('x@gmail.com', { aud: 'evil-client' }) });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'social_token');
});

test('an expired token is refused', async () => {
  const res = await post({ provider: 'google', token: googleToken('x@gmail.com', { exp: now() - 3600 }) });
  assert.equal(res.statusCode, 401);
});

test('a token signed with a foreign key is refused', async () => {
  const foreign = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const forged = signToken(
    { iss: 'https://accounts.google.com', aud: GOOGLE_AUD, sub: 'g-forged', email: 'forged@gmail.com', email_verified: true, exp: now() + 600 },
    createPrivateKey(foreign.privateKey.export({ format: 'pem', type: 'pkcs8' })),
  );
  assert.ok(createPublicKey(foreign.publicKey.export({ format: 'pem', type: 'spki' })));
  const res = await post({ provider: 'google', token: forged });
  assert.equal(res.statusCode, 401);
});

test('an explicitly unverified e-mail is refused', async () => {
  const res = await post({ provider: 'google', token: googleToken('unverified@gmail.com', { email_verified: false }) });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'social_email');
});
