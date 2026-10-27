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

// M135 (owner, 2026-10-27: «كل ساعة خبر تقريبًا من ٩ص لحد ١٢ بالليل»): one push per Riyadh hour between
// 9:00 and 23:00 — the best fresh story nobody was notified about yet, any topic, per device language,
// the body always the source's own title (rule 7). Nothing repeats and quiet hours stay quiet.
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

// Riyadh instants of "today": inside the window (19:xx, 20:xx) and before it (03:30).
const at = (time: string) => Date.parse(`${riyadhDay(Date.now())}T${time}+03:00`);
const evening = at('19:30:00.000');
const hourly = () => built.news as unknown as { pushHourlyNews(now?: number): Promise<void> };
type State = { day: string; sentHours: number[]; pushedIds: string[] };

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

test('one push per hour: the best fresh story each hour, per language, nothing twice', async () => {
  await kv.set(NEWS_SNAPSHOT_KEY, {
    version: 1,
    items: [
      story('markets-ar', { title: 'أرباح الشركات السعودية ترتفع في الربع الثالث' }),
      story('sports-ar', { sourceId: 'arriyadiyah', sourceName: 'الرياضية', title: 'الهلال يحسم ديربي الرياض', topics: ['sports'] as TopicKey[], publishedAt: new Date(Date.now() - 4 * 3_600_000).toISOString() }),
      story('markets-en', { lang: 'en', title: 'Saudi market closes higher', sourceName: 'Arab News', sourceId: 'arabnews' }),
    ],
    updatedAt: new Date().toISOString(),
  } satisfies NewsSnapshot);
  await built.news.start();
  const before = pushBatches.length;

  // Before the window (03:30 Riyadh): quiet.
  await hourly().pushHourlyNews(at('03:30:00.000'));
  assert.equal(pushBatches.length, before, 'no push outside the 9→23 window');

  // 19:30 — one push only (arabic + english batches), the top business story of each language.
  await hourly().pushHourlyNews(evening);
  const first = pushBatches.slice(before).flat();
  assert.equal(first.filter((message) => message.to === 'ExponentPushToken[m134-arabic]').length, 1, JSON.stringify(first));
  assert.equal(first.find((message) => message.to === 'ExponentPushToken[m134-arabic]')?.body, 'أرباح الشركات السعودية ترتفع في الربع الثالث');
  assert.equal(first.find((message) => message.to === 'ExponentPushToken[m134-english]')?.body, 'Saudi market closes higher');
  assert.ok(first.every((message) => message.title.includes('أهم أخبار اليوم') || message.title.includes('Top business story')), JSON.stringify(first));
  for (const message of first) assert.match(message.data.screen ?? '', /^\/news\/[a-f0-9]{16}$/);

  // The same hour again: already sent, nothing more.
  const afterFirst = pushBatches.length;
  await hourly().pushHourlyNews(evening + 60_000);
  assert.equal(pushBatches.length, afterFirst);

  // The next hour: the next-best unpushed story (sports) goes out with the sports title.
  await hourly().pushHourlyNews(at('20:30:00.000'));
  const second = pushBatches.slice(afterFirst).flat();
  assert.ok(second.length > 0, 'the next hour pushes the next story');
  for (const message of second) assert.equal(message.body, 'الهلال يحسم ديربي الرياض');
  assert.ok(second.every((message) => message.title.includes('أخبار الرياضة اليوم') || message.title.includes('Sports today')), JSON.stringify(second));

  // Everything is pushed: the following hour stays quiet, and both hours are recorded.
  const afterSecond = pushBatches.length;
  await hourly().pushHourlyNews(at('21:30:00.000'));
  assert.equal(pushBatches.length, afterSecond, 'no fresh story left, no push');
  const state = await kv.get<State>(NEWS_DAILY_PUSH_KEY);
  assert.deepEqual(state?.sentHours.sort(), [19, 20]);
});

test('an hour with no fresh story stays silent and is not recorded, so the same hour retries', async () => {
  await kv.set(NEWS_DAILY_PUSH_KEY, { day: '2020-01-01', sentHours: [], pushedIds: [] });
  await kv.set(NEWS_SNAPSHOT_KEY, {
    version: 1,
    items: [story('stale', { publishedAt: new Date(Date.now() - 30 * 3_600_000).toISOString() })],
    updatedAt: new Date().toISOString(),
  } satisfies NewsSnapshot);
  await built.news.start();
  const before = pushBatches.length;
  await hourly().pushHourlyNews(evening);
  assert.equal(pushBatches.length, before, 'a stale-only feed must not notify');
  const state = await kv.get<State>(NEWS_DAILY_PUSH_KEY);
  assert.deepEqual(state?.sentHours ?? [], [], 'an unsent hour is not recorded, so the next poll retries');
});
