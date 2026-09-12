import { XMLParser } from 'fast-xml-parser';

import { BROWSER_UA, type FetchImpl } from '../news/rss.js';

/** The club channel on YouTube, read without a key through its public feed; the Data API (key in env) lists the full catalogue. */
export type ChannelInfo = { id: string; title: string; url: string };

export type VideoEntry = {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnail: string;
};

const CHANNEL_ID = /UC[A-Za-z0-9_-]{22}/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY = 4_000_000;
const MAX_DESCRIPTION = 600;
const API_BASE = 'https://www.googleapis.com/youtube/v3';
const API_PAGE_SIZE = 50;
const API_MAX_PAGES = 10;

type Rec = Record<string, unknown>;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

export function isVideoId(value: string): boolean {
  return VIDEO_ID.test(value);
}

export function videoUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function thumbnailUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function channelPageUrl(handleOrId: string): string {
  const value = handleOrId.trim();
  if (CHANNEL_ID.test(value) && value.startsWith('UC')) return `https://www.youtube.com/channel/${value}`;
  return `https://www.youtube.com/${value.startsWith('@') ? value : `@${value}`}`;
}

export function feedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

/** The channel id from a channel page: the identifier meta tag, the canonical link or the embedded player config. */
export function extractChannelId(html: string): string | null {
  const patterns = [
    /<meta\s+itemprop=["']identifier["']\s+content=["'](UC[A-Za-z0-9_-]{22})["']/i,
    /<link\s+rel=["']canonical["']\s+href=["']https?:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})["']/i,
    /"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/,
    /"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/,
    /https?:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function extractChannelTitle(html: string): string | null {
  const match = /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i.exec(html);
  return match?.[1] ? decodeEntities(match[1]).trim() : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function fetchText(url: string, fetchImpl: FetchImpl, accept: string): Promise<string> {
  const response = await fetchImpl(url, {
    headers: { 'user-agent': BROWSER_UA, accept, 'accept-language': 'en,ar;q=0.8', cookie: 'CONSENT=YES+1' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.text()).slice(0, MAX_BODY);
}

/** Resolves a handle («@investorscl») or a channel id to the channel. */
export async function resolveChannel(handleOrId: string, fetchImpl: FetchImpl = fetch): Promise<ChannelInfo> {
  const value = handleOrId.trim();
  if (value.startsWith('UC') && CHANNEL_ID.test(value)) return { id: value, title: '', url: channelPageUrl(value) };
  const url = channelPageUrl(value);
  const html = await fetchText(url, fetchImpl, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.7');
  const id = extractChannelId(html);
  if (!id) throw new Error('Channel id not found on the channel page');
  return { id, title: extractChannelTitle(html) ?? '', url };
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) return text((value as Rec)['#text']);
  return '';
}

function list(value: unknown): Rec[] {
  if (Array.isArray(value)) return value.filter((entry): entry is Rec => Boolean(entry) && typeof entry === 'object');
  return value && typeof value === 'object' ? [value as Rec] : [];
}

function toIso(value: string): string | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function cleanDescription(value: string): string {
  return value.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_DESCRIPTION);
}

/** The channel's public Atom feed: the latest uploads (15 at most) with the description and thumbnail per entry. */
export function parseVideoFeed(xml: string): { title: string; videos: VideoEntry[] } {
  const doc = parser.parse(xml) as Rec;
  const feed = list(doc.feed)[0];
  if (!feed) throw new Error('Not a YouTube feed');
  const videos: VideoEntry[] = [];
  for (const entry of list(feed.entry)) {
    const id = text(entry['yt:videoId']).trim();
    const title = text(entry.title).trim();
    const publishedAt = toIso(text(entry.published));
    if (!isVideoId(id) || !title || !publishedAt) continue;
    const media = list(entry['media:group'])[0] ?? {};
    const thumbnail = list(media['media:thumbnail'])[0];
    const thumbnailSrc = thumbnail ? text(thumbnail['@_url']) : '';
    videos.push({
      id,
      title,
      description: cleanDescription(text(media['media:description'])),
      publishedAt,
      thumbnail: thumbnailSrc.startsWith('https://') ? thumbnailSrc : thumbnailUrl(id),
    });
  }
  return { title: text(feed.title).trim(), videos };
}

export async function fetchVideoFeed(channelId: string, fetchImpl: FetchImpl = fetch): Promise<{ title: string; videos: VideoEntry[] }> {
  const xml = await fetchText(feedUrl(channelId), fetchImpl, 'application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5');
  return parseVideoFeed(xml);
}

type PlaylistItem = {
  snippet?: { title?: string; description?: string; publishedAt?: string; resourceId?: { videoId?: string }; thumbnails?: Record<string, { url?: string }> };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
  status?: { privacyStatus?: string };
};

/** Every upload through the Data API (the uploads playlist is the channel id with «UU» in front). Key from env only. */
export async function fetchUploadsViaApi(channelId: string, apiKey: string, fetchImpl: FetchImpl = fetch): Promise<VideoEntry[]> {
  const playlistId = `UU${channelId.slice(2)}`;
  const videos: VideoEntry[] = [];
  let pageToken = '';
  for (let page = 0; page < API_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ part: 'snippet,contentDetails,status', maxResults: String(API_PAGE_SIZE), playlistId, key: apiKey });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetchImpl(`${API_BASE}/playlistItems?${params.toString()}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`YouTube API HTTP ${response.status}`);
    const body = (await response.json()) as { items?: PlaylistItem[]; nextPageToken?: string };
    for (const entry of body.items ?? []) {
      const id = entry.contentDetails?.videoId ?? entry.snippet?.resourceId?.videoId ?? '';
      const title = entry.snippet?.title?.trim() ?? '';
      const publishedAt = toIso(entry.contentDetails?.videoPublishedAt ?? entry.snippet?.publishedAt ?? '');
      const privacy = entry.status?.privacyStatus ?? 'public';
      if (!isVideoId(id) || !title || !publishedAt || privacy !== 'public') continue;
      if (/^(private|deleted) video$/i.test(title)) continue;
      const thumbs = entry.snippet?.thumbnails ?? {};
      const thumbnail = thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? thumbnailUrl(id);
      videos.push({ id, title, description: cleanDescription(entry.snippet?.description ?? ''), publishedAt, thumbnail });
    }
    pageToken = body.nextPageToken ?? '';
    if (!pageToken) break;
  }
  return videos;
}
