import { XMLParser } from 'fast-xml-parser';

import { htmlToText } from '../projectsBank/text.js';
import { isSpaApi, parseSpaList } from './spa.js';

/** One entry of a feed, as the source published it. */
export type FeedEntry = {
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string | null;
  image: string | null;
  /** Aggregator feeds (Bing News) name the original outlet per entry. */
  sourceName: string | null;
  /** JSON endpoint carrying the source's own body text (SPA), read after the page is verified. */
  detailUrl: string | null;
};

export type FetchImpl = typeof fetch;

const FEED_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 3_000_000;
const MAX_SUMMARY = 500;
/** Some Saudi outlets answer 403 to non-browser agents; the server identifies as a browser for feeds and pages. */
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const TRACKING_PARAMS = /^(utm_|at_|fbclid$|gclid$|traffic_source$|ref$|source$|ito$)/i;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  ignoreDeclaration: true,
  parseTagValue: false,
});

type Node = unknown;
type Rec = Record<string, unknown>;

function first(node: Node): Node {
  return Array.isArray(node) ? node[0] : node;
}

function text(node: Node): string {
  const value = first(node);
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const inner = (value as Rec)['#text'];
    return typeof inner === 'string' ? inner.trim() : typeof inner === 'number' ? String(inner) : '';
  }
  return '';
}

function attr(node: Node, name: string): string {
  const value = first(node);
  if (value && typeof value === 'object') {
    const raw = (value as Rec)[`@_${name}`];
    return typeof raw === 'string' ? raw.trim() : '';
  }
  return '';
}

function list(node: Node): Node[] {
  if (node === null || node === undefined) return [];
  return Array.isArray(node) ? node : [node];
}

function clean(value: string, max: number): string {
  return htmlToText(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function toIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Unwraps aggregator redirects and drops tracking parameters so the same article has one URL. */
export function canonicalUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (/(^|\.)bing\.com$/i.test(url.hostname) && url.pathname.toLowerCase() === '/news/apiclick.aspx') {
    const target = url.searchParams.get('url');
    if (!target) return null;
    return canonicalUrl(target);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  return url.toString();
}

function imageFromHtml(html: string): string | null {
  const match = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
  return match?.[1] && /^https?:\/\//i.test(match[1]) ? match[1] : null;
}

function imageOf(item: Rec, html: string): string | null {
  const candidates = [
    attr(item['media:thumbnail'], 'url'),
    ...list(item['media:content']).map((node) => (attr(node, 'medium') === 'image' || /^image\//.test(attr(node, 'type')) || /\.(jpe?g|png|webp)(\?|$)/i.test(attr(node, 'url')) ? attr(node, 'url') : '')),
    ...list(item.enclosure).map((node) => (/^image\//.test(attr(node, 'type')) ? attr(node, 'url') : '')),
    text(item['News:Image']),
  ];
  const found = candidates.find((value) => /^https?:\/\//i.test(value));
  return found ?? imageFromHtml(html);
}

function rssEntry(node: Node): FeedEntry | null {
  const item = first(node) as Rec;
  if (!item || typeof item !== 'object') return null;
  const title = clean(text(item.title), 300);
  const guid = text(item.guid);
  const rawLink = text(item.link) || attr(item.link, 'href') || (/^https?:\/\//i.test(guid) ? guid : '');
  const url = rawLink ? canonicalUrl(rawLink) : null;
  if (!title || !url) return null;
  const html = text(item.description) || text(item['content:encoded']) || text(item.summary);
  const summary = clean(html, MAX_SUMMARY);
  return {
    title,
    url,
    summary: summary || null,
    publishedAt: toIso(text(item.pubDate) || text(item['dc:date']) || text(item.published)),
    image: imageOf(item, html),
    sourceName: clean(text(item['News:Source']) || text(item.source), 80) || null,
    detailUrl: null,
  };
}

function atomEntry(node: Node): FeedEntry | null {
  const item = first(node) as Rec;
  if (!item || typeof item !== 'object') return null;
  const title = clean(text(item.title), 300);
  const links = list(item.link);
  const alternate = links.find((link) => !attr(link, 'rel') || attr(link, 'rel') === 'alternate') ?? links[0];
  const url = alternate ? canonicalUrl(attr(alternate, 'href') || text(alternate)) : null;
  if (!title || !url) return null;
  const html = text(item.summary) || text(item.content);
  return {
    title,
    url,
    summary: clean(html, MAX_SUMMARY) || null,
    publishedAt: toIso(text(item.published) || text(item.updated)),
    image: imageOf(item, html),
    sourceName: null,
    detailUrl: null,
  };
}

/** RSS 2.0, RSS 1.0 (RDF) and Atom. Entries without a title or a usable link are skipped. */
export function parseFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(xml) as Rec;
  const channel = (first(doc.rss) as Rec | undefined)?.channel as Rec | undefined;
  if (channel) return list(channel.item).map(rssEntry).filter((entry): entry is FeedEntry => entry !== null);
  const feed = first(doc.feed) as Rec | undefined;
  if (feed) return list(feed.entry).map(atomEntry).filter((entry): entry is FeedEntry => entry !== null);
  const rdf = first(doc['rdf:RDF']) as Rec | undefined;
  if (rdf) return list(rdf.item).map(rssEntry).filter((entry): entry is FeedEntry => entry !== null);
  throw new Error('Unrecognized feed format');
}

export async function fetchFeed(url: string, fetchImpl: FetchImpl = fetch): Promise<FeedEntry[]> {
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': BROWSER_UA,
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
      'accept-language': 'ar,en;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_FEED_BYTES) throw new Error('Feed too large');
  const body = (await response.text()).slice(0, MAX_FEED_BYTES);
  if (isSpaApi(url)) return parseSpaList(body);
  if (/^\s*<!doctype html|^\s*<html/i.test(body)) throw new Error('Not a feed (HTML page)');
  return parseFeed(body);
}
