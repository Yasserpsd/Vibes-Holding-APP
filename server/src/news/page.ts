import { htmlToText } from '../projectsBank/text.js';
import { BROWSER_UA, toIso, type FetchImpl } from './rss.js';

/** What the article page says about itself (Open Graph and friends). Nothing here is generated. */
export type PageMeta = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  publishedAt: string | null;
};

const PAGE_TIMEOUT_MS = 12_000;
const MAX_PAGE_BYTES = 400_000;

function clean(value: string, max: number): string | null {
  const flat = htmlToText(value).replace(/\s+/g, ' ').trim();
  return flat ? flat.slice(0, max) : null;
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) {
    attributes[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

/** Reads the meta tags of a page. Exported for tests. */
export function extractMeta(html: string): Omit<PageMeta, 'url'> {
  const head = html.slice(0, 250_000);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag);
    const key = (attributes.property ?? attributes.name ?? attributes.itemprop ?? '').toLowerCase();
    const content = attributes.content;
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = meta.get(key);
      if (value?.trim()) return value;
    }
    return null;
  };
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '';
  const jsonLdDate = /"datePublished"\s*:\s*"([^"]+)"/.exec(head)?.[1] ?? '';
  const rawImage = pick('og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src');
  return {
    title: clean(pick('og:title', 'twitter:title') ?? titleTag, 300),
    description: clean(pick('og:description', 'description', 'twitter:description') ?? '', 600),
    image: rawImage && /^https?:\/\//i.test(rawImage.trim()) ? rawImage.trim() : null,
    siteName: clean(pick('og:site_name', 'application-name') ?? '', 80),
    publishedAt: toIso(pick('article:published_time', 'og:article:published_time', 'article:modified_time') ?? jsonLdDate),
  };
}

function charsetOf(contentType: string): string {
  return /charset=["']?([a-zA-Z0-9_-]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? '';
}

function decode(buffer: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset || 'utf-8').decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

/** Reads at most `limit` bytes: the meta tags sit at the top, the rest of the page is not needed. */
async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const body = response.body;
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  if (size >= limit) await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Fetches the article page (CLAUDE.md rule 7: an item is shown only when its URL was fetched
 * successfully). Rejects non-HTML answers so PDFs and images never become news items.
 */
export async function fetchArticle(url: string, fetchImpl: FetchImpl = fetch): Promise<PageMeta> {
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': BROWSER_UA,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.7',
      'accept-language': 'ar,en;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !/html|xml/i.test(contentType)) throw new Error(`Not a web page (${contentType.split(';')[0]})`);
  const bytes = await readLimited(response, MAX_PAGE_BYTES);
  let charset = charsetOf(contentType);
  if (!charset) {
    const sniff = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
    charset = charsetOf(sniff) || /<meta[^>]+charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i.exec(sniff)?.[1]?.toLowerCase() || '';
  }
  const html = decode(bytes, charset);
  return { url: response.url || url, ...extractMeta(html) };
}
