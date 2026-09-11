import type { KV } from '../store.js';
import type { NewsSource, NewsSourcesContent } from './types.js';

export const NEWS_SOURCES_KEY = 'content:news:sources';

/** Bing News RSS search: the only stable feed for outlets without RSS. Links carry the original article URL. */
function bing(query: string): string {
  return `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&setlang=ar&cc=sa&qft=sortbydate%3d%221%22`;
}

/** Saudi Press Agency portal API (no RSS); see spa.ts. Category ids: 1 general, 2 political, 3 economic, 7 tourism, 12 science and technology. */
function spa(categoryId: number): string {
  return `https://portalapi.spa.gov.sa/api/v1/news?category_id=${categoryId}&per_page=30`;
}

/**
 * Default sources (tiers from the brief: Saudi official → trusted Saudi media → global).
 * Verified on 2026-09-12; the owner edits the list from the dashboard later (key `content:news:sources`).
 * English outlets are seeded disabled: the app is Arabic-first and items are shown as the source wrote them.
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
  { id: 'saudigazette-business', name: 'Saudi Gazette', url: 'https://saudigazette.com.sa/rssFeed/73', tier: 'saudi', lang: 'en', enabled: false, hint: 'Saudi Gazette — Business' },
  { id: 'arabnews', name: 'Arab News', url: 'https://www.arabnews.com/rss.xml', tier: 'saudi', lang: 'en', enabled: false, hint: 'Arab News — all sections' },
  { id: 'bbc-arabic-business', name: 'BBC عربي', url: 'https://feeds.bbci.co.uk/arabic/business/rss.xml', tier: 'global', lang: 'ar', enabled: true, hint: 'BBC عربي — اقتصاد وأعمال' },
];

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

export function outletNameFor(url: string, fallback: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = Object.keys(OUTLET_NAMES).find((domain) => host === domain || host.endsWith(`.${domain}`));
    return match ? OUTLET_NAMES[match]! : fallback;
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
    typeof source.enabled === 'boolean'
  );
}

export async function ensureNewsSourcesSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<NewsSourcesContent>(NEWS_SOURCES_KEY);
  if (existing) return false;
  await kv.set(NEWS_SOURCES_KEY, { sources: NEWS_SOURCES_SEED, updatedAt: new Date().toISOString() } satisfies NewsSourcesContent);
  return true;
}

/** Stored sources (dashboard-editable); malformed rows are skipped, an empty store falls back to the seed. */
export async function getNewsSources(kv: KV): Promise<NewsSource[]> {
  const content = await kv.get<NewsSourcesContent>(NEWS_SOURCES_KEY);
  const rows = Array.isArray(content?.sources) ? content.sources.filter(isSource) : [];
  return rows.length > 0 ? rows.map((row) => ({ ...row, hint: typeof row.hint === 'string' ? row.hint : null })) : NEWS_SOURCES_SEED;
}
