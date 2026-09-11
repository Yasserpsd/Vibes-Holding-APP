import { htmlToText } from '../projectsBank/text.js';
import { BROWSER_UA, type FeedEntry, type FetchImpl } from './rss.js';

/**
 * The Saudi Press Agency has no RSS; its portal API lists the same items the website shows.
 * List: https://portalapi.spa.gov.sa/api/v1/news?category_id=3 (Arabic with accept-language: ar).
 * The article page (www.spa.gov.sa/ar/<uuid>) is still fetched for verification like any other item.
 */
const API_HOST = 'portalapi.spa.gov.sa';
const SITE = 'https://www.spa.gov.sa/ar/';
const DETAIL_TIMEOUT_MS = 12_000;
const MAX_SNIPPET = 400;
/** SPA titles start with the desk name («اقتصادي / …»); the desk is a label, not part of the headline. */
const DESK_PREFIX = /^[؀-ۿ\s]{2,14}\/\s*/;
/** SPA bodies open with a dateline that ends with the agency's name («الرياض … واس»). */
const DATELINE = /^[^\n]{0,120}?واس\s*\n\s*/;

type SpaListItem = { uuid?: unknown; title?: unknown; published_at?: unknown; image?: { path?: unknown } | null };

export function isSpaApi(url: string): boolean {
  try {
    return new URL(url).hostname === API_HOST;
  } catch {
    return false;
  }
}

export function parseSpaList(body: string): FeedEntry[] {
  const parsed = JSON.parse(body) as { data?: unknown };
  const rows = Array.isArray(parsed.data) ? (parsed.data as SpaListItem[]) : [];
  const entries: FeedEntry[] = [];
  for (const row of rows) {
    const uuid = typeof row.uuid === 'string' ? row.uuid.trim() : '';
    const title = typeof row.title === 'string' ? htmlToText(row.title).replace(/\s+/g, ' ').replace(DESK_PREFIX, '').trim() : '';
    if (!/^[A-Za-z0-9]+$/.test(uuid) || !title) continue;
    const seconds = typeof row.published_at === 'number' ? row.published_at : Number(row.published_at);
    const image = row.image && typeof row.image === 'object' && typeof row.image.path === 'string' && /^https?:\/\//.test(row.image.path) ? row.image.path : null;
    entries.push({
      title: title.slice(0, 300),
      url: `${SITE}${uuid}`,
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
export async function fetchSpaSnippet(detailUrl: string, fetchImpl: FetchImpl = fetch): Promise<string | null> {
  const response = await fetchImpl(detailUrl, {
    headers: { 'user-agent': BROWSER_UA, accept: 'application/json', 'accept-language': 'ar' },
    signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: { content?: unknown } };
  const content = typeof body.data?.content === 'string' ? body.data.content : '';
  const text = htmlToText(content).replace(DATELINE, '').trim();
  if (!text) return null;
  const paragraph = text.split(/\n+/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  return paragraph ? paragraph.slice(0, MAX_SNIPPET) : null;
}
