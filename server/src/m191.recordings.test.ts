import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

const RECORDING = '6b1f0c2e-8d4a-4f3b-9e7c-2a5d8f1b3c4e';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PROCESSING = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

const config = loadConfig({
  LOG_LEVEL: 'silent',
  HUB_MODE: 'mock',
  NEWS_REFRESH_MINUTES: '0',
  VIDEOS_REFRESH_MINUTES: '0',
  BUNNY_STREAM_LIBRARY_ID: '123456',
  BUNNY_STREAM_API_KEY: 'library-api-key-for-tests',
  BUNNY_STREAM_CDN_HOST: 'vz-test.b-cdn.net',
  BUNNY_STREAM_TOKEN_KEY: 'pull-zone-token-key',
});

// Bunny's API answers from here; every other request keeps the real fetch.
const realFetch = globalThis.fetch;
const bunnyFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith('https://video.bunnycdn.com/')) return realFetch(input, init);
  if (url.endsWith(`/videos/${PROCESSING}`)) return Response.json({ status: 3, availableResolutions: '' });
  return Response.json({ status: 4, availableResolutions: '360p,720p,1080p,2160p' });
};

let built: BuiltApp;
let app: BuiltApp['app'];
let memberToken = '';
let visitorToken = '';
let adminToken = '';
let eventId = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'PATCH', url: string, payload: Record<string, unknown>, token?: string) => app.inject({ method, url, payload, headers: bearer(token) });

async function signUp(email: string, phone: string): Promise<string> {
  const registered = await send('POST', '/api/auth/register', { name: 'ضياء الجندي', country: 'sa', phone, email, password: 'secret123', persona: 'neutral', bio: 'حساب اختبار تسجيلات الورش للأعضاء.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  const token = verified.json().token as string;
  const completed = await send('PATCH', '/api/me', { jobTitle: 'مدير', company: 'شركة الاختبار', city: 'الرياض', website: 'https://example.test', social: 'https://x.com/test' }, token);
  assert.equal(completed.statusCode, 200, completed.body);
  return token;
}

before(async () => {
  globalThis.fetch = bunnyFetch;
  built = await buildApp({ config, kv: new MemoryKV(), mailer: new LogMailer() });
  app = built.app;
  memberToken = await signUp('m191+member@gmail.com', '0558619001');
  visitorToken = await signUp('m191.visitor@gmail.com', '0558619002');
  adminToken = await signUp('m191.admin@gmail.com', '0558619003');
});

after(async () => {
  globalThis.fetch = realFetch;
  await app.close();
});

test('the dashboard attaches playable Bunny videos to a workshop; one still processing is refused', async () => {
  const past = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  const created = await send('POST', '/api/admin/agenda', { title: 'ورشة الذكاء الاصطناعي', date: past, mode: 'both', feeSar: 290, open: false, recordings: [{ title: 'اليوم الأول', videoId: RECORDING }] }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  eventId = created.json().event.id as string;

  const processing = await send('PUT', `/api/admin/agenda/${eventId}`, { recordings: [{ title: 'اليوم الأول', videoId: RECORDING }, { title: 'اليوم الثاني', videoId: PROCESSING }] }, adminToken);
  assert.equal(processing.statusCode, 400, processing.body);
  assert.match(processing.json().error.message, /قيد المعالجة/);
});

test('everyone sees the titles; the videos never appear in the public event', async () => {
  const event = await get(`/api/agenda/${eventId}`, visitorToken);
  assert.equal(event.statusCode, 200, event.body);
  assert.deepEqual(event.json().event.recordings, [{ title: 'اليوم الأول' }]);
  assert.ok(!event.body.includes(RECORDING));
  assert.ok(!(await get('/api/agenda', visitorToken)).body.includes(RECORDING));
});

test('only an active annual member gets the signed links, whatever ticket anyone bought', async () => {
  assert.equal((await get(`/api/agenda/${eventId}/recordings`)).statusCode, 401);
  const visitor = await get(`/api/agenda/${eventId}/recordings`, visitorToken);
  assert.equal(visitor.statusCode, 403);
  assert.equal(visitor.json().error.code, 'members_only');

  const member = await get(`/api/agenda/${eventId}/recordings`, memberToken);
  assert.equal(member.statusCode, 200, member.body);
  assert.equal(member.headers['cache-control'], 'no-store');
  const [recording] = member.json().recordings as { title: string; url: string; poster: string }[];
  assert.equal(recording?.title, 'اليوم الأول');
  assert.match(recording?.url ?? '', new RegExp(`^https://vz-test\\.b-cdn\\.net/bcdn_token=[^/]+/${RECORDING}/playlist\\.m3u8$`));
  assert.match(recording?.poster ?? '', new RegExp(`/${RECORDING}/thumbnail\\.jpg$`));
});

test('the public stream link refuses a recording but still serves post videos', async () => {
  assert.equal((await get(`/media/stream/${RECORDING}/playlist.m3u8`)).statusCode, 404);
  assert.equal((await get(`/media/stream/${RECORDING}/thumbnail.jpg`)).statusCode, 404);
  assert.equal((await get(`/media/stream/${OTHER}/playlist.m3u8`)).statusCode, 302);
});
