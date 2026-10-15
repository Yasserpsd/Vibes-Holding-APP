import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MockHubClient } from '../hub/mock.js';
import { MemoryKV } from '../store.js';

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];

before(async () => {
  const built = await buildApp({ config, kv, hub: new MockHubClient() });
  app = built.app;
});

after(async () => {
  await app.close();
});

test('legal pages are public Arabic HTML and declare the first-party analytics', async () => {
  for (const path of ['/legal/privacy', '/legal/terms', '/legal/account-deletion']) {
    const res = await app.inject({ method: 'GET', url: path });
    assert.equal(res.statusCode, 200, path);
    assert.match(String(res.headers['content-type']), /text\/html/);
    assert.ok(res.body.includes('dir="rtl"'), path);
    assert.ok(res.body.includes('نادي المستثمرين'), path);
  }
  const privacy = await app.inject({ method: 'GET', url: '/legal/privacy' });
  // M33 analytics must be declared (M8), in Arabic and in the English summary.
  assert.ok(privacy.body.includes('معرّف جهاز عشوائي'));
  assert.ok(privacy.body.includes('random device identifier'));
  assert.ok(privacy.body.includes('no third-party analytics SDK'));
  const terms = await app.inject({ method: 'GET', url: '/legal/terms' });
  assert.ok(terms.body.includes('ضمانًا لعوائد'));
});

test('the store settings fall back to the server-hosted legal pages', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/membership/store' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(String(body.termsUrl).endsWith('/legal/terms'));
  assert.ok(String(body.privacyUrl).endsWith('/legal/privacy'));
});

test('deletion requests validate the e-mail, honeypot and rate limit', async () => {
  const form = (payload: string) =>
    app.inject({ method: 'POST', url: '/legal/account-deletion', payload, headers: { 'content-type': 'application/x-www-form-urlencoded' } });

  const invalid = await form('email=not-an-email');
  assert.equal(invalid.statusCode, 400);
  assert.ok(invalid.body.includes('بريدًا إلكترونيًا صحيحًا'));

  // Honeypot filled: fake success, no counter movement.
  const bot = await form('email=bot%40example.com&website=spam');
  assert.equal(bot.statusCode, 200);

  for (let i = 0; i < 5; i += 1) {
    const ok = await form(`email=member${i}%40example.com&name=%D8%B9%D8%B6%D9%88&note=please`);
    assert.equal(ok.statusCode, 200);
    assert.ok(ok.body.includes('استلمنا طلبك'));
  }
  const limited = await form('email=member9%40example.com');
  assert.equal(limited.statusCode, 429);
});
