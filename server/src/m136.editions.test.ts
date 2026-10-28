import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { NEWS_PICKS_KEY, NEWS_SNAPSHOT_KEY, newsIdOf, type PicksState } from './news/service.js';
import { NEWS_SEED_VERSION, NEWS_SOURCES_KEY } from './news/sources.js';
import type { NewsItem, NewsSnapshot, TopicKey } from './news/types.js';
import { DAY_MS, riyadhDay } from './riyadh.js';
import { MemoryKV } from './store.js';

// M136 (owner, 2026-10-28: «العملاء اشتكوا من كتر الأخبار — خبرين فقط في اليوم لكل مجال، حسب اهتماماته»):
// two editions a day (10:00 and 19:00 Riyadh), each ONE story per topic, so a topic never shows more than two
// stories a day; the feed is those picks only, narrowed to the member's interests; each edition sends ONE push
// per device — the best pick among the account's interests — the body always the source's own title (rule 7).
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com' });

type PushMessage = { to: string; title: string; body: string; data: Record<string, string> };
const pushBatches: PushMessage[][] = [];
const fetchStub: typeof fetch = async (input, init) => {
  if (String(input) !== 'https://exp.host/--/api/v2/push/send') throw new Error(`unexpected fetch: ${String(input)}`);
  const messages = JSON.parse(String(init?.body)) as PushMessage[];
  pushBatches.push(messages);
  return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) }), { status: 200 });
};

// The test day is TOMORROW (Riyadh), so the real clock never fills an edition by itself: today's two editions are seeded as done.
const today = riyadhDay(Date.now());
const tomorrow = riyadhDay(Date.now() + DAY_MS);
const at = (day: string, time: string) => Date.parse(`${day}T${time}+03:00`);
const morning = at(tomorrow, '10:30:00.000');
const evening = at(tomorrow, '19:30:00.000');
const doneToday = (): PicksState => ({
  editions: [2, 1].map((slot) => ({ day: today, slot, filledAt: new Date().toISOString(), picks: { ar: [], en: [] }, pushedAt: new Date().toISOString() })),
  pickedIds: [],
});

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
  publishedAt: new Date(morning - 2 * 3_600_000).toISOString(),
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
let token = '';
const ARABIC = 'ExponentPushToken[m136-arabic]';
const ENGLISH = 'ExponentPushToken[m136-english]';
const urls = (page: { items: Array<{ url: string }> }) => page.items.map((item) => item.url.replace('https://news.example.test/', ''));

before(async () => {
  await kv.set(NEWS_SOURCES_KEY, { sources: [], updatedAt: new Date().toISOString(), seedVersion: NEWS_SEED_VERSION });
  await kv.set(NEWS_PICKS_KEY, doneToday());
  built = await buildApp({ config, kv, mailer: new LogMailer(), fetchImpl: fetchStub });
  app = built.app;
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'مجرب الإصدارات اليومية', country: 'sa', phone: '0558618862', email: 'm136@gmail.com', password: 'secret123', persona: 'investor', bio: 'حساب اختبار إصدارات الأخبار اليومية.' } });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  assert.equal(verified.statusCode, 200, verified.body);
  token = verified.json().token as string;
  const arabic = await app.inject({ method: 'POST', url: '/api/push/tokens', payload: { token: ARABIC, platform: 'android' }, headers: { authorization: `Bearer ${token}` } });
  assert.equal(arabic.statusCode, 200, arabic.body);
  const english = await app.inject({ method: 'POST', url: '/api/push/tokens', payload: { token: ENGLISH, platform: 'ios' }, headers: { authorization: `Bearer ${token}`, 'x-app-lang': 'en' } });
  assert.equal(english.statusCode, 200, english.body);
  // The member follows sports only.
  const prefs = await app.inject({ method: 'PUT', url: '/api/news/prefs', payload: { topics: ['sports'] }, headers: { authorization: `Bearer ${token}` } });
  assert.equal(prefs.statusCode, 200, prefs.body);
});

after(async () => {
  await app.close();
});

test('two editions a day, one story per topic each: the feed shows the picks only and every device gets one push per edition, by interest', async () => {
  await kv.set(NEWS_PICKS_KEY, doneToday());
  await kv.set(NEWS_SNAPSHOT_KEY, {
    version: 1,
    items: [
      story('eco-1', { title: 'أرباح الشركات السعودية ترتفع في الربع الثالث', relevance: 90 }),
      story('eco-2', { title: 'تداول يغلق مرتفعًا', relevance: 80 }),
      story('eco-3', { title: 'الصادرات غير النفطية تنمو', relevance: 70 }),
      story('sports-1', { sourceId: 'arriyadiyah', sourceName: 'الرياضية', title: 'الهلال يحسم ديربي الرياض', topics: ['sports'] as TopicKey[], relevance: 80 }),
      story('en-1', { lang: 'en', title: 'Saudi market closes higher', sourceName: 'Arab News', sourceId: 'arabnews', topics: ['markets'] as TopicKey[] }),
    ],
    updatedAt: new Date().toISOString(),
  } satisfies NewsSnapshot);
  await built.news.start();
  const before = pushBatches.length;

  // Before the first edition (03:30): nothing is picked, nothing is pushed.
  await built.news.runEditions(at(tomorrow, '03:30:00.000'));
  assert.equal(pushBatches.length, before, 'no edition before 10:00');

  // 10:30 — the morning edition: one story per topic (eco-3 finds no free topic), one push per device.
  await built.news.runEditions(morning);
  const first = pushBatches.slice(before).flat();
  assert.equal(first.filter((message) => message.to === ARABIC).length, 1, JSON.stringify(first));
  assert.equal(first.filter((message) => message.to === ENGLISH).length, 1, JSON.stringify(first));
  const arabicPush = first.find((message) => message.to === ARABIC)!;
  assert.equal(arabicPush.body, 'الهلال يحسم ديربي الرياض', 'the member follows sports, so the sports pick is his push');
  assert.ok(arabicPush.title.includes('أخبار الرياضة اليوم'), arabicPush.title);
  const englishPush = first.find((message) => message.to === ENGLISH)!;
  assert.equal(englishPush.body, 'Saudi market closes higher', 'no English sports story: the edition\'s best English story instead');
  assert.ok(englishPush.title.includes('Top business story'), englishPush.title);
  for (const message of first) assert.match(message.data.screen ?? '', /^\/news\/[a-f0-9]{16}$/);

  // The feed is the picks only: a guest sees every topic (two stories at most per topic), the member his interests.
  const guest = await app.inject({ method: 'GET', url: '/api/news/feed' });
  assert.deepEqual(urls(guest.json()).sort(), ['eco-1', 'eco-2', 'sports-1'], 'eco-3 is the third economy/markets story: not today');
  assert.equal(guest.json().total, 3);
  const mine = await app.inject({ method: 'GET', url: '/api/news/feed', headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual(urls(mine.json()), ['sports-1']);
  assert.equal(mine.json().personalized, true);
  const markets = await app.inject({ method: 'GET', url: '/api/news/feed?topic=markets' });
  assert.deepEqual(urls(markets.json()).sort(), ['eco-1', 'eco-2'], 'a topic chip shows the picks of the day that carry it, two at most');
  const english = await app.inject({ method: 'GET', url: '/api/news/feed?lang=en' });
  assert.deepEqual(urls(english.json()), ['en-1']);

  // The same edition again: nothing more goes out.
  const afterMorning = pushBatches.length;
  await built.news.runEditions(morning + 60_000);
  assert.equal(pushBatches.length, afterMorning);

  // 19:30 — the evening edition: the next story per topic (eco-3 under economy); the member has no new sports story, so he gets the edition's best.
  await built.news.runEditions(evening);
  const second = pushBatches.slice(afterMorning).flat();
  assert.equal(second.filter((message) => message.to === ARABIC).length, 1, JSON.stringify(second));
  assert.equal(second.filter((message) => message.to === ENGLISH).length, 1, 'an English device with no English pick hears the Arabic one');
  for (const message of second) assert.equal(message.body, 'الصادرات غير النفطية تنمو');
  const evening2 = await app.inject({ method: 'GET', url: '/api/news/feed' });
  assert.deepEqual(urls(evening2.json()).sort(), ['eco-1', 'eco-2', 'eco-3', 'sports-1'], 'the day shows both editions: two stories per topic at most');

  // Nothing else all day, and both editions are recorded as sent.
  const afterEvening = pushBatches.length;
  await built.news.runEditions(at(tomorrow, '23:30:00.000'));
  assert.equal(pushBatches.length, afterEvening, 'two pushes a day per device, never more');
  const state = await kv.get<PicksState>(NEWS_PICKS_KEY);
  const sent = state?.editions.filter((edition) => edition.day === tomorrow).map((edition) => [edition.slot, edition.pushedAt !== null]);
  assert.deepEqual(sent?.sort(), [[1, true], [2, true]]);
});

test('an edition with nothing fresh is not recorded, so the next poll retries it', async () => {
  await kv.set(NEWS_PICKS_KEY, doneToday());
  await kv.set(NEWS_SNAPSHOT_KEY, {
    version: 1,
    items: [story('stale', { publishedAt: new Date(morning - 30 * 3_600_000).toISOString() })],
    updatedAt: new Date().toISOString(),
  } satisfies NewsSnapshot);
  await built.news.start();
  const before = pushBatches.length;
  await built.news.runEditions(morning);
  assert.equal(pushBatches.length, before, 'a stale-only feed must not notify');
  const state = await kv.get<PicksState>(NEWS_PICKS_KEY);
  assert.equal(state?.editions.some((edition) => edition.day === tomorrow), false, 'an empty edition is not recorded');
});
