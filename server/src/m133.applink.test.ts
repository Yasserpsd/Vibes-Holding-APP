import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { APP_STORE_URL, PLAY_STORE_URL } from './legal/applink.js';
import { MemoryKV } from './store.js';

let app: Awaited<ReturnType<typeof buildApp>>['app'];

before(async () => {
  const kv = new MemoryKV();
  ({ app } = await buildApp({ config: loadConfig({ LOG_LEVEL: 'silent' }), kv }));
});

after(async () => {
  await app.close();
});

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

test('m133: /app sends an iPhone to the App Store', async () => {
  const res = await app.inject({ method: 'GET', url: '/app', headers: { 'user-agent': IPHONE_UA } });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, APP_STORE_URL);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('m133: /app sends an Android to Google Play', async () => {
  const res = await app.inject({ method: 'GET', url: '/app', headers: { 'user-agent': ANDROID_UA } });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, PLAY_STORE_URL);
});

test('m133: /app shows both store buttons to anything else', async () => {
  const res = await app.inject({ method: 'GET', url: '/app', headers: { 'user-agent': DESKTOP_UA } });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /text\/html/);
  assert.ok(res.body.includes(APP_STORE_URL));
  assert.ok(res.body.includes(PLAY_STORE_URL));
});
