import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { NEWS_DAILY_PUSH_KEY, NEWS_SNAPSHOT_KEY, newsIdOf } from './news/service.js';
import { NEWS_SEED_VERSION, NEWS_SOURCES_KEY } from './news/sources.js';
import type { NewsItem, NewsSnapshot, TopicKey } from './news/types.js';
import { riyadhDay } from './riyadh.js';
import { MemoryKV } from './store.js';

// M134 (owner: «عايز نوتفكيشن توصل تخلي الناس تفتح الأبلكيشن»): two daily digests — the morning's top
// business story (10:00 Riyadh) and the evening's top sports story (19:00 Riyadh), once per Riyadh day,
// per device language, the body always the source's own title (rule 7).
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com' });

type PushMessage = { to: string; title: string; body: string; data: Record<string, string> };
const pushBatches: PushMessage[][] = [];
const fetchStub: typeof fetch = async (input, init) => {
  if (String(input) !== 'https://exp.host/--/api/v2/push/send') throw new Error(`unexpected fetch: ${String(input)}`);
  const messages = JSON.parse(String(init?.body)) as PushMessage[];
  pushBatches.push(messages);
  return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) }), { status: 200 });
};

const story = (slug: string, over: Partial<NewsItem> = {}): NewsItem => ({
  id: newsIdOf(`https://news.example.test/${slug}`),
  sourceId: 'argaam',
  sourceName: 'أرقام',
  tier: 'saudi',
  lang: 'ar',
  title: `خبر ${slug}`,
  snippet: 'الموجز كما أورده المصدر.',
  url: `https://news.example.test/${slug}`,
  image: null,
  publishedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  verifiedAt: new Date().toISOString(),
  classifiedBy: 'keywords',
  hidden: false,
  duplicateOf: null,
  topics: ['economy', 'markets'] as TopicKey[],
  decision: false,
  businessAngle: true,
  relevance: 80,
  ...over,
});

const kv = new MemoryKV();
let built: BuiltApp;
let app: BuiltApp['app'];

// A Riyadh evening instant of "today": both digest hours (10 and 19) have passed.
const evening = Date.parse(`${riyadhDay(Date.now())}T19:30:00.000+03:00`);
const digests = () => built.news as unknown as { pushDailyDigests(now?: number): Promise<void> };

before(async () => {
  await kv.set(NEWS_SOURCES_KEY, { sources: [], updatedAt: new Date().toISOString(), seedVersion: NEWS_SEED_VERSION });
  built = await buildApp({ config, kv, mailer: new LogMailer(), fetchImpl: fetchStub });
  app = built.app;
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'مجرب الملخص اليومي', country: 'sa', phone: '0558618861', email: 'm134@gmail.com', password: 'secret123', persona: 'investor', bio: 'حساب اختبار الملخص اليومي للأخبار.' } });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  assert.equal(verified.statusCode, 200, verified.body);
  const token = verified.json().token as string;
  const arabic = await app.inject({ method: 'POST', url: '/api/push/tokens', payload: { token: 'ExponentPushToken[m134-arabic]', platform: 'android' }, headers: { authorization: `Bearer ${token}` } });
  assert.equal(arabic.statusCode, 200, arabic.body);
  const english = await app.inject({ method: 'POST', url: '/api/push/tokens', payload: { token: 'ExponentPushToken[m134-english]', platform: 'ios' }, headers: { authorization: `Bearer ${token}`, 'x-app-lang': 'en' } });
  assert.equal(english.statusCode, 200, english.body);
});

after(async () => {
  await app.close();
});

test('each digest goes out once per day, per language, with the source title as the body', async () => {
  await kv.set(NEWS_SNAPSHOT_KEY, {
    version: 1,
    items: [
      story('markets-ar', { title: 'أرباح الشركات السعودية ترتفع في الربع الثالث' }),
      story('sports-ar', { sourceId: 'arriyadiyah', sourceName: 'الرياضية', title: 'الهلال يحسم ديربي الرياض', topics: ['sports'] as TopicKey[] }),
      story('markets-en', { lang: 'en', title: 'Saudi market closes higher', sourceName: 'Arab News', sourceId: 'arabnews' }),
    ],
    updatedAt: new Date().toISOString(),
  } satisfies NewsSnapshot);
  await built.news.start();
  const before = pushBatches.length;

  await digests().pushDailyDigests(evening);
  // Two digests × (arabic batch + english batch). The english sports digest falls back to the Arabic story.
  const sent = pushBatches.slice(before).flat();
  const top = sent.filter((message) => message.title.includes('أهم أخبار اليوم') || message.title.includes('Top business story'));
  const sports = sent.filter((message) => message.title.includes('أخبار الرياضة اليوم') || message.title.includes('Sports today'));
  assert.equal(top.length, 2, JSON.stringify(sent));
  assert.equal(sports.length, 2, JSON.stringify(sent));
  assert.equal(top.find((message) => message.to === 'ExponentPushToken[m134-arabic]')?.body, 'أرباح الشركات السعودية ترتفع في الربع الثالث');
  assert.equal(top.find((message) => message.to === 'ExponentPushToken[m134-english]')?.body, 'Saudi market closes higher');
  for (const message of sports) assert.equal(message.body, 'الهلال يحسم ديربي الرياض');
  for (const message of sent) assert.match(message.data.screen ?? '', /^\/news\/[a-f0-9]{16}$/);

  // The same evening again: both digests are already recorded for today, nothing more goes out.
  await digests().pushDailyDigests(evening + 60_000);
  assert.equal(pushBatches.length - before, 4);

  // A new day before the morning hour: still quiet; after the morning hour the top digest returns with a FRESH story only.
  const state = await kv.get<{ day: string; sent: string[] }>(NEWS_DAILY_PUSH_KEY);
  assert.deepEqual(state?.sent.sort(), ['sports', 'top']);
});

test('a digest with no fresh story stays silent and retries later the same day', async () => {
  await kv.set(NEWS_DAILY_PUSH_KEY, { day: '2020-01-01', sent: [], pushedIds: [] });
  await kv.set(NEWS_SNAPSHOT_KEY, {
    version: 1,
    items: [story('stale', { publishedAt: new Date(Date.now() - 30 * 3_600_000).toISOString() })],
    updatedAt: new Date().toISOString(),
  } satisfies NewsSnapshot);
  await built.news.start();
  const before = pushBatches.length;
  await digests().pushDailyDigests(evening);
  assert.equal(pushBatches.length, before, 'a stale-only feed must not notify');
  const state = await kv.get<{ sent: string[] }>(NEWS_DAILY_PUSH_KEY);
  assert.deepEqual(state?.sent, [], 'an unsent digest is not recorded, so the next poll retries');
});
