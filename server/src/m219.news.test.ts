import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadConfig } from './config.js';
import { BreakingNewsService } from './news/breaking.js';
import { KeywordClassifier, moneyGuard } from './news/classify.js';
import { NEWS_PUSH_DAILY_CAP } from './news/pushCap.js';
import { NEWS_PICKS_KEY, NEWS_SNAPSHOT_KEY, NewsService, PICKS_RULE, cleanImage, newsIdOf, type PicksState } from './news/service.js';
import { NEWS_SEED_VERSION, NEWS_SOURCES_KEY } from './news/sources.js';
import type { NewsItem, NewsSnapshot, TopicKey } from './news/types.js';
import type { PushMessage, PushService } from './push/service.js';
import { DAY_MS, riyadhDay } from './riyadh.js';
import { MemoryKV } from './store.js';

// M219 (owner, 2026-11-09): «الأخبار اللي يوصل بيها نوتفكيشن تكون 2 فقط في اليوم — أحيانًا بيوصل فوق 8»,
// «الأخبار اللي ليها علاقة فقط بالاقتصاد وأسعار الذهب والنفط والمال … وأي أخبار تانية تتشال بشكل كامل»,
// «تختار ديما الأخبار اللي ليها صورة … ودي قاعدة ثابتة».
const silentLog = { warn() {}, info() {}, error() {}, debug() {} } as never;
const config = loadConfig({ LOG_LEVEL: 'silent', NEWS_REFRESH_MINUTES: '0' });

const today = riyadhDay(Date.now());
const tomorrow = riyadhDay(Date.now() + DAY_MS);
const at = (time: string) => Date.parse(`${tomorrow}T${time}+03:00`);
const morning = at('10:30:00.000');
const noon = at('12:00:00.000');
const evening = at('19:30:00.000');
const doneToday = (): PicksState => ({
  editions: [2, 1].map((slot) => ({ day: today, slot, filledAt: new Date().toISOString(), picks: { ar: [], en: [] }, pushedAt: new Date().toISOString() })),
  pickedIds: [],
  rule: PICKS_RULE,
});

const story = (slug: string, over: Partial<NewsItem> = {}): NewsItem => ({
  id: newsIdOf(`https://news.example.test/${slug}`),
  sourceId: 'argaam',
  sourceName: 'أرقام',
  tier: 'saudi',
  lang: 'ar',
  title: 'تداول يغلق مرتفعًا',
  snippet: 'الموجز كما أورده المصدر.',
  url: `https://news.example.test/${slug}`,
  image: `https://news.example.test/photos/${slug}.jpg`,
  publishedAt: new Date(morning - 2 * 3_600_000).toISOString(),
  verifiedAt: new Date().toISOString(),
  classifiedBy: 'keywords',
  hidden: false,
  duplicateOf: null,
  topics: ['markets'] as TopicKey[],
  decision: false,
  businessAngle: true,
  relevance: 80,
  ...over,
});

async function serviceWith(items: NewsItem[], waves: PushMessage[]): Promise<{ news: NewsService; push: PushService; kv: MemoryKV }> {
  const kv = new MemoryKV();
  await kv.set(NEWS_SOURCES_KEY, { sources: [], updatedAt: new Date().toISOString(), seedVersion: NEWS_SEED_VERSION });
  await kv.set(NEWS_PICKS_KEY, doneToday());
  await kv.set(NEWS_SNAPSHOT_KEY, { version: 1, items, updatedAt: new Date().toISOString() } satisfies NewsSnapshot);
  const push = {
    broadcastEach: async (choose: (device: { contactId: number; persona: string | null; lang: string | null }) => Promise<PushMessage | null> | PushMessage | null) => {
      const message = await choose({ contactId: 1, persona: null, lang: 'ar' });
      if (message) waves.push(message);
      return { sent: message ? 1 : 0, failed: 0 };
    },
  } as unknown as PushService;
  const news = new NewsService({ kv, config, log: silentLog, classifier: new KeywordClassifier(), push });
  await news.start();
  return { news, push, kv };
}

const feedOf = (news: NewsService) => news.feed({ page: 1, limit: 50, lang: 'ar' }, { prefs: null, persona: '' }).items.map((item) => item.url.replace('https://news.example.test/', ''));

test('M219: a headline must speak money — municipal, campus and inspection items are never club news', () => {
  // Real headlines the live feed carried on 2026-11-09, with the labels the model gave them.
  const dropped: [string, TopicKey[]][] = [
    ['جامعة الملك سعود تعلن موعد التقديم على برامج الدراسات العليا للعام الدراسي', ['economy', 'finance']],
    ['"أمانة جدة": ربط طريقي الأمير مشعل بن ماجد والمدينة المنورة لتحسين انسيابية الحركة', ['economy']],
    ['أمانة تبوك تعزز التنمية العمرانية بإصدار أكثر من 4 آلاف قرار مساحي', ['economy']],
    ['ضبط وإتلاف 20 طنًا من المواد الغذائية منتهية الصلاحية قبل وصولها لأسواق تبوك', ['economy']],
    ['«البلديات» تتمسك بشرط الـ100 ألف لترخيص المقاولين وتوافق على «المهلة»', ['economy']],
    ['وزارة الصناعة والثروة المعدنية تنفذ 757 جولة رقابية على المواقع التعدينية', ['energy']],
    ['البلديات تلاحق مخالفات محلات الخياطة', ['economy']],
    ['الهلال يحسم ديربي الرياض', ['sports']],
    ['وادي الغر.. أيقونة سياحية تجسد تنوع البيئة', ['tourism']],
  ];
  for (const [title, topics] of dropped) assert.equal(moneyGuard(title, topics), false, title);
  const kept: [string, TopicKey[]][] = [
    ['النفط يتراجع 13% خلال أسبوع', ['oil']],
    ['العراق يسعى لرفع معدلات إنتاج النفط إلى 10 ملايين برميل يومياً', ['oil', 'energy']],
    ['التضخم الأميركي يقود أسبوعاً حاسماً للأسواق... والفائدة في دائرة الترقب', ['markets', 'economy']],
    ['أسعار الذهب تسجل أعلى مستوى في شهر', ['metals']],
    ['أديس تفوز بعقود لمنصتين في الهند بقيمة 439.6 مليون ريال', ['energy']],
    ['الأمانة العامة لأوبك تتوقع ارتفاع الطلب على النفط', ['oil']],
    ['Gold plunges to a one-year low as silver slides', ['metals']],
    ['Federal Reserve holds interest rates steady', ['markets']],
  ];
  for (const [title, topics] of kept) assert.equal(moneyGuard(title, topics), true, title);
  assert.equal(moneyGuard('أسعار الذهب تسجل أعلى مستوى في شهر', ['tourism']), false, 'a money section is required too');
});

test('M219: image URLs are repaired, and a placeholder is not a photo', () => {
  assert.equal(cleanImage('http://www.bing.com/th?id=ONUT.abc&pid=News'), 'https://www.bing.com/th?id=ONUT.abc&pid=News', 'phones refuse cleartext http');
  assert.equal(cleanImage('https://cdnx.premiumread.com/?f=jpg&amp;q=80&amp;url=https://www.al-madina.com/x.jpg'), 'https://cdnx.premiumread.com/?f=jpg&q=80&url=https://www.al-madina.com/x.jpg');
  assert.equal(cleanImage('https://www.alwatan.com.sa/themes/watanksa/images/no-image.png'), null);
  assert.equal(cleanImage('https://www.argaam.com/content/ar/images/argaam-plus-ar.jpg'), null);
  assert.equal(cleanImage('not a url'), null);
  assert.equal(cleanImage(null), null);
});

test('M219: only money stories with a photo of their own are shown', async () => {
  const brand = 'https://outlet.example.test/brand.png';
  const { news } = await serviceWith(
    [
      story('photo'),
      story('no-photo', { image: null, title: 'النفط يتراجع 13% خلال أسبوع', topics: ['oil'] }),
      story('brand-1', { image: brand, title: 'أسعار الذهب ترتفع', topics: ['metals'] }),
      story('brand-2', { image: brand, title: 'البنوك تعلن أرباحها', topics: ['finance'] }),
      story('brand-3', { image: brand, title: 'الاقتصاد ينمو', topics: ['economy'] }),
      story('campus', { title: 'جامعة الملك سعود تعلن موعد التقديم', topics: ['economy', 'finance'], decision: true }),
      story('sports', { title: 'الهلال يحسم ديربي الرياض', topics: ['sports'] }),
    ],
    [],
  );
  await news.runEditions(morning);
  assert.deepEqual(feedOf(news), ['photo']);
  assert.equal(news.decisions({ page: 1, limit: 50, lang: 'ar' }).total, 0, 'a civic «decision» is not a decision of the club');
  assert.equal(news.status().visible, 1);
});

test('M219: two news pushes a day in all — the editions and breaking share one budget', async () => {
  const waves: PushMessage[] = [];
  const { news, push, kv } = await serviceWith(
    [
      story('markets-1', { relevance: 90 }),
      story('markets-2', { title: 'مؤشر السوق السعودية يرتفع بدعم البنوك', relevance: 70 }),
      story('hot', { title: 'أرامكو تعلن أرباحًا قياسية بـ 120 مليار دولار في صفقة تاريخية', topics: ['oil'], publishedAt: new Date(noon - 30 * 60_000).toISOString() }),
    ],
    waves,
  );
  const breaking = new BreakingNewsService({ kv, log: silentLog, news, push, enabled: true });

  await news.runEditions(morning);
  assert.equal(waves.length, 1, 'the morning edition');
  assert.equal(await breaking.tick(noon), true);
  assert.equal(waves.length, 2, 'one breaking story');
  assert.match(waves[1]?.title ?? '', /عاجل/);

  // The evening edition has a fresh pick, but the day's two pushes are spent: it shows in the feed and stays silent.
  await news.runEditions(evening);
  await news.runEditions(evening + 3_600_000);
  assert.equal(await breaking.tick(evening + 2 * 3_600_000), false);
  assert.equal(waves.length, NEWS_PUSH_DAILY_CAP, 'never a third news push in a day');
  assert.equal(await news.pushCap.sentToday(evening), NEWS_PUSH_DAILY_CAP);
  assert.ok(feedOf(news).includes('markets-2'), 'the evening pick still reaches the feed');
});
