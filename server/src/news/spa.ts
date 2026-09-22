import { htmlToText } from '../projectsBank/text.js';
import { BROWSER_UA, type FeedEntry, type FetchImpl } from './rss.js';
import type { NewsLang } from './types.js';

/**
 * The Saudi Press Agency has no RSS; its portal API lists the same items the website shows.
 * List: https://portalapi.spa.gov.sa/api/v1/news?category_id=3 (the Arabic wire with accept-language: ar,
 * the English wire with accept-language: en; each wire has its own items and ids).
 * The article page (www.spa.gov.sa/<ar|en>/<uuid>) is still fetched for verification like any other item.
 */
const API_HOST = 'portalapi.spa.gov.sa';
const SITE = 'https://www.spa.gov.sa/';
const DETAIL_TIMEOUT_MS = 12_000;
const MAX_SNIPPET = 400;
/** SPA titles start with the desk name («اقتصادي / …»); the desk is a label, not part of the headline. */
const DESK_PREFIX = /^[؀-ۿ\s]{2,14}\/\s*/;
/** SPA bodies open with a dateline that ends with the agency's name («الرياض … واس»). */
const DATELINE = /^[^\n]{0,120}?واس\s*\n\s*/;
/** The English wire keeps the dateline on the first line («Riyadh, September 21, 2026, SPA -- …»). */
const DATELINE_EN = /^[^\n]{0,120}?\bSPA\s*-{1,2}\s*/;

type SpaListItem = { uuid?: unknown; locale?: unknown; title?: unknown; published_at?: unknown; image?: { path?: unknown } | null };

export function isSpaApi(url: string): boolean {
  try {
    return new URL(url).hostname === API_HOST;
  } catch {
    return false;
  }
}

export function parseSpaList(body: string, lang: NewsLang = 'ar'): FeedEntry[] {
  const parsed = JSON.parse(body) as { data?: unknown };
  const rows = Array.isArray(parsed.data) ? (parsed.data as SpaListItem[]) : [];
  const entries: FeedEntry[] = [];
  for (const row of rows) {
    const uuid = typeof row.uuid === 'string' ? row.uuid.trim() : '';
    const title = typeof row.title === 'string' ? htmlToText(row.title).replace(/\s+/g, ' ').replace(DESK_PREFIX, '').trim() : '';
    if (!/^[A-Za-z0-9]+$/.test(uuid) || !title) continue;
    // A cached answer of the other wire (see `spa()` in sources.ts) never becomes an item of this one.
    if (typeof row.locale === 'string' && row.locale !== lang) continue;
    const seconds = typeof row.published_at === 'number' ? row.published_at : Number(row.published_at);
    const image = row.image && typeof row.image === 'object' && typeof row.image.path === 'string' && /^https?:\/\//.test(row.image.path) ? row.image.path : null;
    entries.push({
      title: title.slice(0, 300),
      url: `${SITE}${lang}/${uuid}`,
      summary: null,
      publishedAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null,
      image,
      sourceName: null,
      detailUrl: `https://${API_HOST}/api/v1/news/${uuid}`,
    });
  }
  return entries;
}

/** The agency's own opening lines, used as the snippet (the web page renders client-side and has no description). */
export async function fetchSpaSnippet(detailUrl: string, fetchImpl: FetchImpl = fetch, lang: NewsLang = 'ar'): Promise<string | null> {
  const response = await fetchImpl(detailUrl, {
    headers: { 'user-agent': BROWSER_UA, accept: 'application/json', 'accept-language': lang },
    signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: { content?: unknown } };
  const content = typeof body.data?.content === 'string' ? body.data.content : '';
  const text = htmlToText(content).replace(lang === 'en' ? DATELINE_EN : DATELINE, '').trim();
  if (!text) return null;
  const paragraph = text.split(/\n+/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  return paragraph ? paragraph.slice(0, MAX_SNIPPET) : null;
}
