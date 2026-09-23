import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M43 (owner: «استخدم AI يترجم كل حاجه مرة واحدة وانا لو لقيت مشكلة ابقي اعدلها»): posts and agenda
// events get their English once at save; the English app reads it; the owner's own wording wins for good.
const config = loadConfig({
  LOG_LEVEL: 'silent',
  HUB_MODE: 'mock',
  NEWS_REFRESH_MINUTES: '0',
  VIDEOS_REFRESH_MINUTES: '0',
  NOTIFY_EMAIL: 'admin@vcmem.com',
  OPENAI_API_KEY: 'sk-test-translation-key',
});

class LeveledHub implements HubClient {
  readonly mode = 'mock' as const;
  private readonly inner = new MockHubClient();
  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    return this.inner.call(op, body);
  }
}

/** OpenAI answers a deterministic «EN <text>»; the Expo push endpoint swallows the M42 auto-sends. */
let translateCalls = 0;
const fetchStub: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://exp.host/--/api/v2/push/send') {
    const messages = JSON.parse(String(init?.body)) as unknown[];
    return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) }), { status: 200 });
  }
  if (url === 'https://api.openai.com/v1/chat/completions') {
    translateCalls += 1;
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const request = JSON.parse(body.messages[1]?.content ?? '{}') as { texts: string[] };
    const texts = request.texts.map((text) => (text.trim() ? `EN ${text}` : ''));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ texts }) } }] }), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${url}`);
};

const hub = new LeveledHub();
const mailer = new LogMailer();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string, lang?: string) =>
  app.inject({ method: 'GET', url, headers: { ...bearer(token), ...(lang ? { 'x-app-lang': lang } : {}) } });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

const postInput = (over: Record<string, unknown> = {}) => ({
  title: 'رسالة الترجمة',
  body: 'نص عربي يشرح مزايا النادي.',
  links: [],
  images: [],
  video: null,
  videoFile: null,
  status: 'published',
  pinned: false,
  kind: 'post',
  event: null,
  poll: null,
  audience: { type: 'all' },
  ...over,
});

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer, fetchImpl: fetchStub });
  app = built.app;
  const registered = await send('POST', '/api/auth/register', { name: 'أدمن الترجمة', country: 'sa', phone: '0558618861', email: 'm43.admin@gmail.com', password: 'secret123', persona: 'neutral', bio: 'حساب اختبار الترجمة التلقائية للمحتوى.' });
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  adminToken = verified.json().token as string;
});

after(async () => {
  await app.close();
});

let postId = '';

test('a saved post gets its English once, and each language reads its own words', async () => {
  const created = await send('POST', '/api/admin/posts', postInput(), adminToken);
  assert.equal(created.statusCode, 201, created.body);
  postId = created.json().post.id as string;
  assert.equal(created.json().post.en.title, 'EN رسالة الترجمة');
  assert.equal(created.json().post.enAuto, true);

  const english = await get('/api/posts', undefined, 'en');
  const englishPost = (english.json().posts as { id: string; title: string; body: string }[]).find((entry) => entry.id === postId);
  assert.equal(englishPost?.title, 'EN رسالة الترجمة');
  assert.equal(englishPost?.body, 'EN نص عربي يشرح مزايا النادي.');

  const arabic = await get('/api/posts');
  const arabicPost = (arabic.json().posts as { id: string; title: string }[]).find((entry) => entry.id === postId);
  assert.equal(arabicPost?.title, 'رسالة الترجمة');
});

test('editing the Arabic retranslates; the owner\'s own English wording then wins for good', async () => {
  const calls = translateCalls;
  const edited = await send('PUT', `/api/admin/posts/${postId}`, postInput({ title: 'رسالة معدلة' }), adminToken);
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().post.en.title, 'EN رسالة معدلة');
  assert.equal(translateCalls, calls + 1);

  // An unchanged save does not call the translator again.
  const same = await send('PUT', `/api/admin/posts/${postId}`, postInput({ title: 'رسالة معدلة' }), adminToken);
  assert.equal(same.statusCode, 200);
  assert.equal(translateCalls, calls + 1);

  const manual = await send('PUT', `/api/admin/posts/${postId}`, postInput({ title: 'رسالة معدلة', english: { title: 'My own title', body: 'My own body.' } }), adminToken);
  assert.equal(manual.statusCode, 200, manual.body);
  assert.equal(manual.json().post.en.title, 'My own title');
  assert.equal(manual.json().post.enAuto, false);

  // The Arabic changes again: his wording stays untouched.
  const again = await send('PUT', `/api/admin/posts/${postId}`, postInput({ title: 'عنوان ثالث', english: { title: 'My own title', body: 'My own body.' } }), adminToken);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().post.en.title, 'My own title');
  assert.equal((await get(`/api/posts/${postId}`, undefined, 'en')).json().post.title, 'My own title');
});

test('an agenda event gets its English the same way, and the English agenda reads it', async () => {
  const soon = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
  const created = await send('POST', '/api/admin/agenda', { title: 'ملتقى الترجمة', blurb: 'وصف عربي للملتقى.', date: soon, time: '19:00', place: 'مقر النادي بالرياض', mode: 'both', feeSar: 0, open: true }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  const eventId = created.json().event.id as string;
  assert.equal(created.json().event.en.title, 'EN ملتقى الترجمة');
  assert.equal(created.json().event.en.place, 'EN مقر النادي بالرياض');

  const english = await get(`/api/agenda/${eventId}`, undefined, 'en');
  assert.equal(english.json().event.title, 'EN ملتقى الترجمة');
  assert.equal(english.json().event.place, 'EN مقر النادي بالرياض');
  assert.equal((await get(`/api/agenda/${eventId}`)).json().event.title, 'ملتقى الترجمة');

  const manual = await send('PUT', `/api/admin/agenda/${eventId}`, { english: { title: 'Translation Meetup', blurb: 'An English blurb.', place: 'Club HQ, Riyadh' } }, adminToken);
  assert.equal(manual.statusCode, 200, manual.body);
  assert.equal(manual.json().event.en.title, 'Translation Meetup');
  assert.equal(manual.json().event.enAuto, false);
  assert.equal((await get(`/api/agenda/${eventId}`, undefined, 'en')).json().event.title, 'Translation Meetup');
});
