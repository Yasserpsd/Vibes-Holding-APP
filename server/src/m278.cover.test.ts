import assert from 'node:assert/strict';
import { before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { MemoryKV } from './store.js';

// M278: a post's cover is its own field. The app reads it as `cover`, and older binaries still find it as the first
// image; the dashboard keeps the cover apart from the pictures inside the content.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });

let app: BuiltApp['app'];
let adminToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const send = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown>, token?: string) => app.inject({ method, url, payload, headers: bearer(token) });

before(async () => {
  app = (await buildApp({ config, kv: new MemoryKV(), hub: new MockHubClient(), fetchImpl: (async () => new Response('{}')) as typeof fetch })).app;
  const registered = await send('POST', '/api/auth/register', { name: 'ناصر العلي', country: 'sa', phone: '0558527801', email: 'm278.admin@gmail.com', password: 'secret123', persona: 'investor', bio: 'حساب لاختبار صورة الغلاف.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  adminToken = verified.json().token as string;
});

test('the cover stays apart in the dashboard and leads the images in the app', async () => {
  const cover = 'https://example.com/cover.jpg';
  const inside = ['https://example.com/a.jpg', 'https://example.com/b.jpg'];
  const created = await send('POST', '/api/admin/posts', { title: 'لقاء الأعضاء', status: 'published', kind: 'post', cover, images: inside }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  const saved = created.json().post as { id: string; cover: string | null; images: string[] };
  assert.equal(saved.cover, cover);
  assert.deepEqual(saved.images, inside);

  const shown = (await app.inject({ method: 'GET', url: `/api/posts/${saved.id}` })).json().post as { cover: string | null; images: string[] };
  assert.equal(shown.cover, cover);
  assert.deepEqual(shown.images, [cover, ...inside]);

  // Removing the cover leaves only the content pictures, as before M278.
  const edited = await send('PUT', `/api/admin/posts/${saved.id}`, { title: 'لقاء الأعضاء', status: 'published', kind: 'post', cover: null, images: inside }, adminToken);
  assert.equal(edited.statusCode, 200, edited.body);
  const after = (await app.inject({ method: 'GET', url: `/api/posts/${saved.id}` })).json().post as { cover: string | null; images: string[] };
  assert.equal(after.cover, null);
  assert.deepEqual(after.images, inside);
});
