import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { NEWS_PUSH_KEY, NEWS_SNAPSHOT_KEY, newsIdOf } from './news/service.js';
import { NEWS_SEED_VERSION, NEWS_SOURCES_KEY } from './news/sources.js';
import type { NewsItem, NewsSnapshot } from './news/types.js';
import { MemoryKV } from './store.js';

// M42 (owner: «بمجرد ما انشر اي رسالة كل الناس يجيلها اشعار فورا… والأخبار برده»): the FIRST publish of a
// post notifies its audience by itself, a new open agenda event notifies every device, and every NEW
// Saudi decision notifies with the source's own title, capped per day.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com' });

class LeveledHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly members = new Set<number>();
  private readonly inner = new MockHubClient();
  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    const response = await this.inner.call(op, body);
    const contact = response.contact;
    if (contact && this.members.has(contact.id)) return { ...response, contact: { ...contact, is_admin: 0, role: 'member' } };
    return response;
  }
}

type PushMessage = { to: string; title: string; body: string; data: Record<string, string> };
const pushBatches: PushMessage[][] = [];
const fetchStub: typeof fetch = async (input, init) => {
  if (String(input) !== 'https://exp.host/--/api/v2/push/send') throw new Error(`unexpected fetch: ${String(input)}`);
  const messages = JSON.parse(String(init?.body)) as PushMessage[];
  pushBatches.push(messages);
  return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) }), { status: 200 });
};

const decision = (index: number, minutesAgo: number): NewsItem => ({
  id: newsIdOf(`https://spa.example.test/decision-${index}`),
  sourceId: 'spa',
  sourceName: 'وكالة الأنباء السعودية',
  tier: 'official',
  lang: 'ar',
  title: `قرار حكومي جديد رقم ${index} يخص الاستثمار`,
  snippet: 'نص القرار كما أورده المصدر.',
  url: `https://spa.example.test/decision-${index}`,
  image: null,
  publishedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  verifiedAt: new Date().toISOString(),
  classifiedBy: 'keywords',
  hidden: false,
  duplicateOf: null,
  topics: ['economy'],
  decision: true,
  businessAngle: true,
  relevance: 90,
});

const hub = new LeveledHub();
const mailer = new LogMailer();
const kv = new MemoryKV();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
let memberToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'مجرب الإشعارات', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب اختبار الإشعارات التلقائية للنادي.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

const postInput = (over: Record<string, unknown> = {}) => ({
  title: 'رسالة ترحيب',
  body: 'أهلًا بكم في نادي المستثمرين.',
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
  // No live source is polled in the test: the sources list is stored empty before the app starts.
  await kv.set(NEWS_SOURCES_KEY, { sources: [], updatedAt: new Date().toISOString(), seedVersion: NEWS_SEED_VERSION });
  built = await buildApp({ config, kv, hub, mailer, fetchImpl: fetchStub });
  app = built.app;
  adminToken = (await signUp('m42.admin@gmail.com', '0558618851')).token;
  const member = await signUp('m42+member@gmail.com', '0558618852');
  memberToken = member.token;
  hub.members.add(member.id);
  await get('/api/me?fresh=1', memberToken);
  const registered = await send('POST', '/api/push/tokens', { token: 'ExponentPushToken[m42-test-device]', platform: 'android' }, memberToken);
  assert.equal(registered.statusCode, 200, registered.body);
});

after(async () => {
  await app.close();
});

test('publishing a post notifies its audience by itself, once — edits never re-notify', async () => {
  const before = pushBatches.length;
  const created = await send('POST', '/api/admin/posts', postInput(), adminToken);
  assert.equal(created.statusCode, 201, created.body);
  await settle();
  assert.equal(pushBatches.length, before + 1);
  assert.equal(pushBatches.at(-1)?.[0]?.title, 'رسالة ترحيب');
  assert.equal(pushBatches.at(-1)?.[0]?.data.screen, `/posts/${created.json().post.id}`);
  // The automatic send is recorded like the button's: the dashboard shows the post notified.
  assert.ok(created.json().post.id);
  const listed = await get('/api/admin/posts', adminToken);
  const row = (listed.json().posts as { id: string; notifiedAt: string | null }[]).find((entry) => entry.id === created.json().post.id);
  assert.ok(row?.notifiedAt);

  const updated = await send('PUT', `/api/admin/posts/${created.json().post.id}`, postInput({ title: 'رسالة معدلة' }), adminToken);
  assert.equal(updated.statusCode, 200, updated.body);
  await settle();
  assert.equal(pushBatches.length, before + 1);
});

test('a draft is silent until its first publish', async () => {
  const before = pushBatches.length;
  const draft = await send('POST', '/api/admin/posts', postInput({ title: 'مسودة صامتة', status: 'draft' }), adminToken);
  assert.equal(draft.statusCode, 201, draft.body);
  await settle();
  assert.equal(pushBatches.length, before);

  const published = await send('PUT', `/api/admin/posts/${draft.json().post.id}`, postInput({ title: 'مسودة صامتة' }), adminToken);
  assert.equal(published.statusCode, 200, published.body);
  await settle();
  assert.equal(pushBatches.length, before + 1);
  assert.equal(pushBatches.at(-1)?.[0]?.title, 'مسودة صامتة');
});

test('a new open agenda event notifies every device; a closed one stays silent', async () => {
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const before = pushBatches.length;
  const open = await send('POST', '/api/admin/agenda', { title: 'ملتقى الإشعار التلقائي', date: soon, mode: 'both', feeSar: 0, open: true }, adminToken);
  assert.equal(open.statusCode, 201, open.body);
  await settle();
  assert.equal(pushBatches.length, before + 1);
  assert.match(pushBatches.at(-1)?.[0]?.title ?? '', /أجندة النادي/);
  assert.match(pushBatches.at(-1)?.[0]?.body ?? '', /ملتقى الإشعار التلقائي/);

  const closed = await send('POST', '/api/admin/agenda', { title: 'فعالية مقفولة بصمت', date: soon, mode: 'hq', feeSar: 0, open: false }, adminToken);
  assert.equal(closed.statusCode, 201, closed.body);
  await settle();
  assert.equal(pushBatches.length, before + 1);
});

test('news: the first run only records the existing decisions; a NEW decision notifies with its own title', async () => {
  await kv.set(NEWS_SNAPSHOT_KEY, { version: 1, items: [decision(1, 60)], updatedAt: new Date().toISOString() } satisfies NewsSnapshot);
  await built.news.start();
  const before = pushBatches.length;
  await built.news.refresh();
  assert.equal(pushBatches.length, before, 'baseline run must not notify');
  const baseline = await kv.get<{ seen: string[] }>(NEWS_PUSH_KEY);
  assert.equal(baseline?.seen.length, 1);

  // The same decision counts as NEW once the state forgets it — the push carries the source's own title.
  await kv.set(NEWS_PUSH_KEY, { seen: [], day: '2020-01-01', sentToday: 0 });
  await built.news.refresh();
  assert.equal(pushBatches.length, before + 1);
  assert.match(pushBatches.at(-1)?.[0]?.title ?? '', /قرارات وأنظمة المملكة/);
  assert.equal(pushBatches.at(-1)?.[0]?.body, 'قرار حكومي جديد رقم 1 يخص الاستثمار');
});

test('news: no more than 3 decision notifications per day, and the skipped ones are never sent stale', async () => {
  await kv.set(NEWS_SNAPSHOT_KEY, { version: 1, items: [1, 2, 3, 4, 5].map((index) => decision(index, index * 10)), updatedAt: new Date().toISOString() } satisfies NewsSnapshot);
  await built.news.start();
  await kv.set(NEWS_PUSH_KEY, { seen: [], day: '2020-01-01', sentToday: 0 });
  const before = pushBatches.length;
  await built.news.refresh();
  assert.equal(pushBatches.length, before + 3);
  const state = await kv.get<{ seen: string[]; sentToday: number }>(NEWS_PUSH_KEY);
  assert.equal(state?.sentToday, 3);
  assert.equal(state?.seen.length, 5, 'every new decision is recorded, sent or skipped');

  // Another run finds nothing new: nothing more goes out.
  await built.news.refresh();
  assert.equal(pushBatches.length, before + 3);
});
