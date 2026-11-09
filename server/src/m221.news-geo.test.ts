import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadConfig } from './config.js';
import { KeywordClassifier } from './news/classify.js';
import { geoOf, type Geo } from './news/geo.js';
import { NEWS_PICKS_KEY, NEWS_SNAPSHOT_KEY, NewsService, PICKS_RULE, newsIdOf, type PicksState } from './news/service.js';
import { NEWS_SEED_VERSION, NEWS_SOURCES_KEY, NEWS_SOURCES_SEED, mergeSeed } from './news/sources.js';
import type { NewsItem, NewsSnapshot, SourceTier, TopicKey } from './news/types.js';
import type { PushMessage, PushService } from './push/service.js';
import { DAY_MS, riyadhDay } from './riyadh.js';
import { MemoryKV } from './store.js';

// M221 (owner, 2026-11-09): «في كمية اخبار عن المغرب و السودان انا عايز اخبار سعودية او عالمية تمس السوق
// السعودي او اسعار اسهم». Measured that day on the live home carousel: 12 stories, 3 Saudi, 5 local to
// Morocco, Sudan, Egypt and Gabon — the ranking never looked at where a story was about.
const silentLog = { warn() {}, info() {}, error() {}, debug() {} } as never;
const config = loadConfig({ LOG_LEVEL: 'silent', NEWS_REFRESH_MINUTES: '0' });

const today = riyadhDay(Date.now());
const tomorrow = riyadhDay(Date.now() + DAY_MS);
const morning = Date.parse(`${tomorrow}T10:30:00.000+03:00`);
const hoursBefore = (hours: number) => new Date(morning - hours * 3_600_000).toISOString();

const MOROCCO = 'ما سبب ارتفاع أسعار الخضروات والفواكه بالمغرب ؟ الوزير حجيرة يجيب';
const SUDAN = 'مع اتساع فجوة الأسعار.. قرار عاجل باستيراد الذرة في السودان';
const SAUDI_MARKET = 'السوق السعودية تتراجع 0.8 % وسط ضغوط الأسهم القيادية';
const GULF_MARKET = 'مع ترقب المستثمرين.. تراجع أسواق أسهم الخليج';
const IRAQ_OIL = 'العراق يسعى لرفع معدلات إنتاج النفط إلى 10 ملايين برميل يومياً';
const ARAMCO = 'أرباح أرامكو تبلغ 100 مليار ريال';

const geo = (title: string, over: { snippet?: string | null; lang?: 'ar' | 'en'; tier?: SourceTier } = {}): Geo =>
  geoOf({ title, snippet: over.snippet ?? null, lang: over.lang ?? 'ar', tier: over.tier ?? 'saudi' });

test('M221: a headline is placed by the country it names', () => {
  // Real headlines of the live feed on 2026-11-09.
  const cases: [string, Geo][] = [
    [MOROCCO, 'foreign'],
    [SUDAN, 'foreign'],
    ['مصر تستهدف مضاعفة حصيلة الضريبة العقارية 3 مرات', 'foreign'],
    ['بلومبرج: مصر تخفض إمدادات الغاز 30% لمصانع السويس للصلب وبشاي وعز للدرفلة', 'foreign'],
    ['الغابون تسعى لإحياء مشروع «مابوني» للمعادن باستثمار يبلغ ملياري دولار', 'foreign'],
    ['الذهب يعاود الصعود في مصر.. والدولار يتراجع لـ53 جنيهاً', 'foreign'],
    ['المغرب يوقف صادرات الطماطم إلى الأسواق الإفريقية', 'foreign'],
    ['الاردن يرفع أسعار المحروقات', 'foreign'],
    [SAUDI_MARKET, 'saudi'],
    ['أسهم السعودية أعلى مستوى 10,054 نقطة', 'saudi'],
    ['«مصفاة الذهب السعودية» تحصل على 10 رخص للتنقيب عن الذهب في تنزانيا', 'saudi'],
    ['استثمارات سعودية جديدة في مصر بقيمة 5 مليارات دولار', 'saudi'],
    [ARAMCO, 'saudi'],
    ['تاسي يغلق مرتفعًا بتداولات 6 مليارات ريال', 'saudi'],
    ['أمير الرياض يدشن مشاريع استثمارية', 'saudi'],
    [IRAQ_OIL, 'global'],
    ['الديمقراطيون يلاحقون ترمب عبر بوابة العملات المشفرة', 'global'],
    ['أسعار الذهب تسجل أعلى مستوى في شهر', 'global'],
    ['التضخم الأميركي يقود أسبوعاً حاسماً للأسواق... والفائدة في دائرة الترقب', 'global'],
    [GULF_MARKET, 'gulf'],
    ['قطر: 42 مليار ريال تراجع بأرصدة السندات وأذون الخزينة', 'gulf'],
    ['5 آلاف مخالفة على منشآت الطاقة خلال 2026', 'neutral'],
    ['المصرف المركزي يثبت الفائدة', 'neutral'],
    ['الوضع المالي للشركات المدرجة يتحسن', 'neutral'],
    ['وزير الرياضة يوقع عقود استثمار', 'neutral'],
  ];
  for (const [title, expected] of cases) assert.equal(geo(title), expected, title);

  assert.equal(geo('Egypt raises fuel prices for the third time this year', { lang: 'en', tier: 'global' }), 'foreign');
  assert.equal(geo('Saudi Aramco signs a gas deal in Egypt', { lang: 'en', tier: 'global' }), 'saudi');
  assert.equal(geo('Nigeria oil output climbs to a five-year high', { lang: 'en', tier: 'global' }), 'global');
  assert.equal(geo('Federal Reserve holds interest rates steady', { lang: 'en', tier: 'global' }), 'global');
  assert.equal(geo('United Kingdom inflation eases', { lang: 'en', tier: 'saudi' }), 'neutral', '«United Kingdom» is not «the Kingdom»');
});

test('M221: the opening lines place a plain headline — a foreign outlet only', () => {
  const title = 'البنك المركزي يثبت أسعار الفائدة';
  const egypt = 'قرر البنك المركزي المصري تثبيت أسعار الفائدة في اجتماعه اليوم.';
  assert.equal(geo(title, { snippet: egypt, tier: 'global' }), 'foreign');
  assert.equal(geo(title, { snippet: egypt, tier: 'saudi' }), 'neutral', 'a Saudi outlet often names a guest country in its first lines');
  assert.equal(geo(title, { snippet: 'أعلن البنك المركزي السعودي «ساما» تثبيت معدل اتفاقيات إعادة الشراء.', tier: 'global' }), 'saudi');
  assert.equal(geo('المملكة المتحدة ترفع الضرائب على البنوك'), 'neutral', '«المملكة المتحدة» is not Saudi Arabia');
});

const story = (slug: string, title: string, topics: TopicKey[], hours: number, over: Partial<NewsItem> = {}): NewsItem => ({
  id: newsIdOf(`https://news.example.test/${slug}`),
  sourceId: 'okaz-economy',
  sourceName: 'عكاظ',
  tier: 'saudi',
  lang: 'ar',
  title,
  snippet: 'الموجز كما أورده المصدر.',
  url: `https://news.example.test/${slug}`,
  image: `https://news.example.test/photos/${slug}.jpg`,
  publishedAt: hoursBefore(hours),
  verifiedAt: new Date().toISOString(),
  classifiedBy: 'keywords',
  hidden: false,
  duplicateOf: null,
  topics,
  decision: false,
  businessAngle: true,
  relevance: 80,
  ...over,
});

test('M221: the home, the feed, «رقم اليوم» and the push carry Saudi and world-market stories, never another country’s local news', async () => {
  const kv = new MemoryKV();
  const pushed: PicksState = {
    editions: [2, 1].map((slot) => ({ day: today, slot, filledAt: new Date().toISOString(), picks: { ar: [], en: [] }, pushedAt: new Date().toISOString() })),
    pickedIds: [],
    rule: PICKS_RULE,
  };
  const items = [
    story('morocco', MOROCCO, ['economy'], 1),
    story('sudan', SUDAN, ['economy'], 1),
    // The day's biggest figure, and the freshest finance story: both would have won before.
    story('egypt', 'مصر تجمع 900 مليار دولار من الضريبة العقارية', ['finance'], 1),
    story('gulf-market', GULF_MARKET, ['markets'], 1),
    story('saudi-market', SAUDI_MARKET, ['markets'], 6),
    story('aramco', ARAMCO, ['oil'], 1),
    story('iraq-oil', IRAQ_OIL, ['energy'], 1),
  ];
  await kv.set(NEWS_SOURCES_KEY, { sources: [], updatedAt: new Date().toISOString(), seedVersion: NEWS_SEED_VERSION });
  await kv.set(NEWS_PICKS_KEY, pushed);
  await kv.set(NEWS_SNAPSHOT_KEY, { version: 1, items, updatedAt: new Date().toISOString() } satisfies NewsSnapshot);
  const waves: PushMessage[] = [];
  const push = {
    broadcastEach: async (choose: (device: { contactId: number; persona: string | null; lang: string | null }) => Promise<PushMessage | null> | PushMessage | null) => {
      const message = await choose({ contactId: 1, persona: null, lang: 'ar' });
      if (message) waves.push(message);
      return { sent: message ? 1 : 0, failed: 0 };
    },
  } as unknown as PushService;
  const news = new NewsService({ kv, config, log: silentLog, classifier: new KeywordClassifier(), push });
  await news.start();
  await news.runEditions(morning);

  const slug = (item: { url: string }) => item.url.replace('https://news.example.test/', '');
  const feed = news.feed({ page: 1, limit: 50, lang: 'ar' }, { prefs: null, persona: '' }).items.map(slug);
  assert.deepEqual([...feed].sort(), ['aramco', 'iraq-oil', 'saudi-market'], 'Morocco, Sudan and Egypt are gone; the older Saudi market story beats the fresher Gulf one for the section');

  const home = news.feed({ page: 1, limit: 50, lang: 'ar', scope: 'home' }, { prefs: null, persona: '' }).items.map(slug);
  assert.deepEqual(home, ['aramco', 'saudi-market', 'iraq-oil'], 'Saudi stories lead, the world oil story follows');

  assert.equal(news.numberOfDay('ar', morning)?.text, '100 مليار', 'the Egyptian 900 billion is not the club’s number');
  assert.equal(news.status().visible, 4, 'the three foreign stories are stored but never shown');
  assert.equal(waves.length, 1);
  assert.equal(waves[0]?.body, ARAMCO, 'the push is the best Saudi story');
});

test('M221: three off-target feeds are switched off once; the owner’s other switches stay', () => {
  const off = ['mubasher-sa', 'aljazeera-economy', 'independentarabia'];
  for (const id of off) assert.equal(NEWS_SOURCES_SEED.find((row) => row.id === id)?.enabled, false, id);
  assert.equal(NEWS_SOURCES_SEED.find((row) => row.id === 'mubasher-markets')?.enabled, true, '«مباشر — الأسواق» stays');

  // The live list on 2026-11-09: the owner had turned مباشر and الوطن back on from the dashboard.
  const stored = NEWS_SOURCES_SEED.map((row) => (row.id === 'mubasher-sa' || row.id === 'alwatan-sa' || row.id === 'aljazeera-economy' ? { ...row, enabled: true } : row));
  const merged = mergeSeed({ sources: stored, updatedAt: new Date().toISOString(), seedVersion: 8 });
  assert.equal(merged?.seedVersion, NEWS_SEED_VERSION);
  for (const id of off) assert.equal(merged?.sources.find((row) => row.id === id)?.enabled, false, id);
  assert.equal(merged?.sources.find((row) => row.id === 'alwatan-sa')?.enabled, true, 'his own switch is not touched');
});
