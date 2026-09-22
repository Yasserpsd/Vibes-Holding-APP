import type { KV } from '../store.js';
import type { NewsLang, NewsSource, NewsSourcesContent } from './types.js';

export const NEWS_SOURCES_KEY = 'content:news:sources';

/** Bing News RSS search: the only stable feed for outlets without RSS. Links carry the original article URL. */
function bing(query: string, lang: NewsLang = 'ar'): string {
  const market = lang === 'en' ? 'setlang=en&cc=us' : 'setlang=ar&cc=sa';
  return `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&${market}&qft=sortbydate%3d%221%22`;
}

/** Saudi Press Agency portal API (no RSS); see spa.ts. The source's `lang` picks the Arabic or the English wire. Category ids: 1 general, 2 political, 3 economic, 7 tourism, 12 science and technology. */
function spa(categoryId: number, lang: NewsLang = 'ar'): string {
  // The agency's CDN caches by URL alone, while the API picks the wire from `accept-language`: two languages on one URL
  // answer each other's rows (seen on 2026-09-22). `locale` gives each wire its own URL, and filters the rows too.
  return `https://portalapi.spa.gov.sa/api/v1/news?category_id=${categoryId}&per_page=30&locale=${lang}`;
}

/**
 * Default sources (tiers from the brief: Saudi official → trusted Saudi media → global).
 * Verified on 2026-09-12; the owner edits the list from the dashboard later (key `content:news:sources`).
 * English sources (M27, checked on 2026-09-22) feed the English version only: Saudi news as foreign and Saudi
 * English outlets wrote it, never translated (rule 7). Outlets whose article pages refuse the server stay disabled.
 */
export const NEWS_SOURCES_SEED: NewsSource[] = [
  { id: 'spa-economy', name: 'واس', url: spa(3), tier: 'official', lang: 'ar', enabled: true, hint: 'وكالة الأنباء السعودية — القسم الاقتصادي' },
  { id: 'spa-general', name: 'واس', url: spa(1), tier: 'official', lang: 'ar', enabled: true, hint: 'وكالة الأنباء السعودية — القسم العام (قرارات الجهات الحكومية)' },
  { id: 'spa-political', name: 'واس', url: spa(2), tier: 'official', lang: 'ar', enabled: true, hint: 'وكالة الأنباء السعودية — القسم السياسي (جلسات مجلس الوزراء)' },
  { id: 'spa-tourism', name: 'واس', url: spa(7), tier: 'official', lang: 'ar', enabled: true, hint: 'وكالة الأنباء السعودية — السياحة والترفيه' },
  { id: 'spa-tech', name: 'واس', url: spa(12), tier: 'official', lang: 'ar', enabled: true, hint: 'وكالة الأنباء السعودية — العلوم والتقنية' },
  { id: 'alarabiya-business', name: 'العربية', url: 'https://www.alarabiya.net/feed/rss2/ar/aswaq.xml', tier: 'saudi', lang: 'ar', enabled: false, hint: 'العربية — قسم الأسواق والاقتصاد (الموقع يرفض طلبات الخادم: 403)' },
  { id: 'alarabiya-saudi', name: 'العربية', url: 'https://www.alarabiya.net/feed/rss2/ar/saudi-today.xml', tier: 'saudi', lang: 'ar', enabled: false, hint: 'العربية — أخبار السعودية اليوم (الموقع يرفض طلبات الخادم: 403)' },
  { id: 'okaz-economy', name: 'عكاظ', url: 'https://www.okaz.com.sa/rssFeed/4', tier: 'saudi', lang: 'ar', enabled: true, hint: 'عكاظ — قسم الاقتصاد' },
  { id: 'okaz-local', name: 'عكاظ', url: 'https://www.okaz.com.sa/rssFeed/1', tier: 'saudi', lang: 'ar', enabled: true, hint: 'عكاظ — المحليات (قرارات وأنظمة)' },
  { id: 'aawsat-economy', name: 'الشرق الأوسط', url: 'https://aawsat.com/feed/economy', tier: 'saudi', lang: 'ar', enabled: true, hint: 'الشرق الأوسط — قسم الاقتصاد' },
  { id: 'aleqt', name: 'الاقتصادية', url: bing('site:aleqt.com'), tier: 'saudi', lang: 'ar', enabled: true, hint: 'صحيفة الاقتصادية' },
  { id: 'argaam', name: 'أرقام', url: bing('site:argaam.com'), tier: 'saudi', lang: 'ar', enabled: false, hint: 'أرقام — أخبار الأسواق والشركات (صفحات الموقع لا تفتح من الخادم: مهلة)' },
  { id: 'maaal', name: 'معال', url: bing('site:maaal.com'), tier: 'saudi', lang: 'ar', enabled: false, hint: 'صحيفة معال الاقتصادية (الموقع يرفض طلبات الخادم: 403)' },
  { id: 'saudigazette-business', name: 'Saudi Gazette', url: 'https://saudigazette.com.sa/rssFeed/73', tier: 'saudi', lang: 'en', enabled: true, hint: 'Saudi Gazette — Business', saudiOnly: true },
  { id: 'arabnews', name: 'Arab News', url: 'https://www.arabnews.com/rss.xml', tier: 'saudi', lang: 'en', enabled: true, hint: 'Arab News — all sections', saudiOnly: true },
  { id: 'bbc-arabic-business', name: 'BBC عربي', url: 'https://feeds.bbci.co.uk/arabic/business/rss.xml', tier: 'global', lang: 'ar', enabled: true, hint: 'BBC عربي — اقتصاد وأعمال' },
  { id: 'spa-en-economy', name: 'SPA', url: spa(3, 'en'), tier: 'official', lang: 'en', enabled: true, hint: 'Saudi Press Agency, English wire — economy desk' },
  { id: 'spa-en-general', name: 'SPA', url: spa(1, 'en'), tier: 'official', lang: 'en', enabled: true, hint: 'Saudi Press Agency, English wire — general desk (government decisions)' },
  { id: 'spa-en-political', name: 'SPA', url: spa(2, 'en'), tier: 'official', lang: 'en', enabled: true, hint: 'Saudi Press Agency, English wire — political desk (cabinet sessions)' },
  { id: 'saudigazette-saudi', name: 'Saudi Gazette', url: 'https://saudigazette.com.sa/rssFeed/74', tier: 'saudi', lang: 'en', enabled: true, hint: 'Saudi Gazette — Saudi Arabia section', saudiOnly: true },
  { id: 'cnbc-saudi', name: 'CNBC', url: bing('site:cnbc.com Saudi Arabia', 'en'), tier: 'global', lang: 'en', enabled: true, hint: 'CNBC — coverage of Saudi Arabia', saudiOnly: true },
  { id: 'bbc-middle-east', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', tier: 'global', lang: 'en', enabled: true, hint: 'BBC News — Middle East (items about Saudi Arabia only)', saudiOnly: true },
  { id: 'agbi-saudi', name: 'AGBI', url: 'https://www.agbi.com/tag/saudi-arabia/feed/', tier: 'global', lang: 'en', enabled: true, hint: 'Arabian Gulf Business Insight — Saudi Arabia', saudiOnly: true },
  { id: 'thenational-business', name: 'The National', url: 'https://www.thenationalnews.com/arc/outboundfeeds/rss/category/business/?outputType=xml', tier: 'global', lang: 'en', enabled: true, hint: 'The National — business (items about Saudi Arabia only)', saudiOnly: true },
  { id: 'semafor', name: 'Semafor', url: 'https://www.semafor.com/rss.xml', tier: 'global', lang: 'en', enabled: true, hint: 'Semafor — all editions (items about Saudi Arabia only)', saudiOnly: true },
  { id: 'reuters-saudi', name: 'Reuters', url: bing('site:reuters.com Saudi Arabia', 'en'), tier: 'global', lang: 'en', enabled: false, hint: 'Reuters — article pages refuse server requests (401)', saudiOnly: true },
  { id: 'bloomberg-saudi', name: 'Bloomberg', url: bing('site:bloomberg.com Saudi Arabia', 'en'), tier: 'global', lang: 'en', enabled: false, hint: 'Bloomberg — article pages refuse server requests (403)', saudiOnly: true },
  { id: 'ft-saudi', name: 'Financial Times', url: 'https://www.ft.com/saudi-arabia?format=rss', tier: 'global', lang: 'en', enabled: false, hint: 'Financial Times — article pages refuse server requests (403)', saudiOnly: true },
  { id: 'ap-saudi', name: 'AP', url: bing('site:apnews.com Saudi Arabia', 'en'), tier: 'global', lang: 'en', enabled: false, hint: 'Associated Press — article pages refuse server requests (403)', saudiOnly: true },
];

/**
 * Revision of the seed. A stored list (dashboard-editable) is never replaced: a newer revision only adds the
 * seed rows it does not have yet and applies that revision's one-time switches, so the owner's edits stay.
 * 2 = M27: the English sources; Arab News and Saudi Gazette turned on and read for their Saudi stories; the SPA
 * feeds get their language in the URL (see `spa()`).
 */
export const NEWS_SEED_VERSION = 2;
const CHANGES_BY_VERSION: Record<number, Record<string, Partial<NewsSource>>> = {
  2: {
    arabnews: { enabled: true, saudiOnly: true },
    'saudigazette-business': { enabled: true, saudiOnly: true },
    'spa-economy': { url: spa(3) },
    'spa-general': { url: spa(1) },
    'spa-political': { url: spa(2) },
    'spa-tourism': { url: spa(7) },
    'spa-tech': { url: spa(12) },
  },
};

/** Outlets behind aggregator links, by domain: the app names the outlet, never the aggregator. */
const OUTLET_NAMES: Record<string, string> = {
  'spa.gov.sa': 'واس',
  'uqn.gov.sa': 'أم القرى',
  'aleqt.com': 'الاقتصادية',
  'argaam.com': 'أرقام',
  'maaal.com': 'معال',
  'alarabiya.net': 'العربية',
  'okaz.com.sa': 'عكاظ',
  'aawsat.com': 'الشرق الأوسط',
  'sabq.org': 'سبق',
  'ajel.sa': 'عاجل',
  'albiladdaily.com': 'البلاد',
  'cnbcarabia.com': 'CNBC عربية',
  'mubasher.info': 'مباشر',
  'bbc.co.uk': 'BBC عربي',
  'bbc.com': 'BBC عربي',
  'saudigazette.com.sa': 'Saudi Gazette',
  'arabnews.com': 'Arab News',
};

/** The same, for items of the English feed: an outlet keeps its English name there. */
const OUTLET_NAMES_EN: Record<string, string> = {
  'spa.gov.sa': 'SPA',
  'saudigazette.com.sa': 'Saudi Gazette',
  'arabnews.com': 'Arab News',
  'bbc.co.uk': 'BBC',
  'bbc.com': 'BBC',
  'cnbc.com': 'CNBC',
  'agbi.com': 'AGBI',
  'thenationalnews.com': 'The National',
  'semafor.com': 'Semafor',
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
  'ft.com': 'Financial Times',
  'apnews.com': 'AP',
};

export function outletNameFor(url: string, fallback: string, lang: NewsLang = 'ar'): string {
  const names = lang === 'en' ? OUTLET_NAMES_EN : OUTLET_NAMES;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = Object.keys(names).find((domain) => host === domain || host.endsWith(`.${domain}`));
    return match ? names[match]! : fallback;
  } catch {
    return fallback;
  }
}

function isSource(value: unknown): value is NewsSource {
  if (typeof value !== 'object' || value === null) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.id === 'string' &&
    typeof source.name === 'string' &&
    typeof source.url === 'string' &&
    (source.tier === 'official' || source.tier === 'saudi' || source.tier === 'global') &&
    (source.lang === 'ar' || source.lang === 'en') &&
    typeof source.enabled === 'boolean' &&
    (source.saudiOnly === undefined || typeof source.saudiOnly === 'boolean')
  );
}

/** Rows of a newer seed revision merged into a stored list; `null` when the list is already up to date. */
export function mergeSeed(stored: NewsSourcesContent): NewsSourcesContent | null {
  const from = stored.seedVersion ?? 1;
  if (from >= NEWS_SEED_VERSION) return null;
  const rows = Array.isArray(stored.sources) ? [...stored.sources] : [];
  const known = new Set(rows.map((row) => row.id));
  for (const seed of NEWS_SOURCES_SEED) if (!known.has(seed.id)) rows.push(seed);
  const changes = new Map<string, Partial<NewsSource>>();
  for (let version = from + 1; version <= NEWS_SEED_VERSION; version += 1) {
    for (const [id, change] of Object.entries(CHANGES_BY_VERSION[version] ?? {})) changes.set(id, { ...changes.get(id), ...change });
  }
  const sources = rows.map((row) => ({ ...row, ...changes.get(row.id) }));
  return { sources, updatedAt: new Date().toISOString(), seedVersion: NEWS_SEED_VERSION };
}

/** Seeds an empty store; a stored list from an older seed revision gets the new rows (see NEWS_SEED_VERSION). */
export async function ensureNewsSourcesSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<NewsSourcesContent>(NEWS_SOURCES_KEY);
  if (existing) {
    const merged = mergeSeed(existing);
    if (!merged) return false;
    await kv.set(NEWS_SOURCES_KEY, merged);
    return true;
  }
  await kv.set(NEWS_SOURCES_KEY, { sources: NEWS_SOURCES_SEED, updatedAt: new Date().toISOString(), seedVersion: NEWS_SEED_VERSION } satisfies NewsSourcesContent);
  return true;
}

/** Stored sources (dashboard-editable); malformed rows are skipped, an empty store falls back to the seed. */
export async function getNewsSources(kv: KV): Promise<NewsSource[]> {
  const content = await kv.get<NewsSourcesContent>(NEWS_SOURCES_KEY);
  const rows = Array.isArray(content?.sources) ? content.sources.filter(isSource) : [];
  return rows.length > 0 ? rows.map((row) => ({ ...row, hint: typeof row.hint === 'string' ? row.hint : null })) : NEWS_SOURCES_SEED;
}
