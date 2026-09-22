import type { FastifyBaseLogger } from 'fastify';

import type { Config } from '../config.js';
import { getVideosContent, type FeaturedVideo } from '../content/videos.js';
import type { AppLang } from '../lang.js';
import type { FetchImpl } from '../news/rss.js';
import type { KV } from '../store.js';
import type { BlurbWriter } from './blurbs.js';
import { fetchUploadsViaApi, fetchVideoFeed, isVideoId, resolveChannel, thumbnailUrl, videoUrl, type ChannelInfo, type VideoEntry } from './youtube.js';

/**
 * Video library: the club's YouTube channel, polled through its public feed (latest uploads)
 * or the Data API when a key is set (full catalogue). Known videos are kept when the feed no
 * longer lists them, so the library grows over time. Blurbs are written once and kept.
 */
export const VIDEOS_SNAPSHOT_KEY = 'videos:snapshot';
export const VIDEO_BLURBS_KEY = 'content:videos:blurbs';

export type Blurb = { text: string; source: 'ai' | 'template' | 'dashboard'; at: string };

export type StoredVideo = VideoEntry & { firstSeenAt: string };

export type VideosSnapshot = {
  channel: ChannelInfo | null;
  mode: 'rss' | 'api' | null;
  fetchedAt: string | null;
  lastError: string | null;
  videos: StoredVideo[];
};

export type PublicVideo = {
  id: string;
  title: string;
  description: string;
  publishedAt: string | null;
  thumbnail: string;
  url: string;
  blurb: string;
  featuredLabel: string | null;
};

export type VideosPage = {
  title: string;
  intro: string;
  channelUrl: string;
  featuredTitle: string;
  featured: PublicVideo[];
  items: PublicVideo[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  updatedAt: string | null;
};

type Deps = { kv: KV; config: Config; log: FastifyBaseLogger; blurbs: BlurbWriter; fetchImpl?: FetchImpl };

const EMPTY: VideosSnapshot = { channel: null, mode: null, fetchedAt: null, lastError: null, videos: [] };

export class VideosService {
  private snapshot: VideosSnapshot = EMPTY;
  private blurbs: Record<string, Blurb> = {};
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: Deps) {}

  async start(): Promise<void> {
    this.snapshot = (await this.deps.kv.get<VideosSnapshot>(VIDEOS_SNAPSHOT_KEY)) ?? EMPTY;
    this.blurbs = (await this.deps.kv.get<Record<string, Blurb>>(VIDEO_BLURBS_KEY)) ?? {};
    const minutes = this.deps.config.VIDEOS_REFRESH_MINUTES;
    if (minutes <= 0) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), minutes * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): { count: number; mode: VideosSnapshot['mode']; channelId: string | null; fetchedAt: string | null; lastError: string | null; blurbs: BlurbWriter['mode'] } {
    return {
      count: this.snapshot.videos.length,
      mode: this.snapshot.mode,
      channelId: this.snapshot.channel?.id ?? null,
      fetchedAt: this.snapshot.fetchedAt,
      lastError: this.snapshot.lastError,
      blurbs: this.deps.blurbs.mode,
    };
  }

  /** Polls the channel; failures keep the previous snapshot and are reported on /health. */
  async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const { config, log } = this.deps;
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    try {
      const channel = this.snapshot.channel ?? (await resolveChannel(config.YOUTUBE_CHANNEL, fetchImpl));
      let entries: VideoEntry[] = [];
      let mode: VideosSnapshot['mode'] = 'rss';
      let title = channel.title;
      if (config.YOUTUBE_API_KEY) {
        try {
          entries = await fetchUploadsViaApi(channel.id, config.YOUTUBE_API_KEY, fetchImpl);
          mode = 'api';
        } catch (error) {
          log.warn({ err: error }, 'YouTube Data API failed, feed used instead');
        }
      }
      if (mode === 'rss') {
        const feed = await fetchVideoFeed(channel.id, fetchImpl);
        entries = feed.videos;
        title = title || feed.title;
      }
      const now = new Date().toISOString();
      const known = new Map(this.snapshot.videos.map((video) => [video.id, video]));
      for (const entry of entries) {
        const previous = known.get(entry.id);
        known.set(entry.id, { ...entry, firstSeenAt: previous?.firstSeenAt ?? now });
      }
      const videos = [...known.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      await this.writeBlurbs(videos);
      this.snapshot = { channel: { ...channel, title }, mode, fetchedAt: now, lastError: null, videos };
      await this.deps.kv.set(VIDEOS_SNAPSHOT_KEY, this.snapshot);
      log.info({ mode, count: videos.length, fresh: entries.length }, 'videos refreshed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.snapshot = { ...this.snapshot, lastError: message };
      log.warn({ err: error }, 'videos refresh failed');
    } finally {
      this.running = false;
    }
  }

  /** Writes a line for every video that has none; dashboard-edited lines are never touched. */
  private async writeBlurbs(videos: StoredVideo[]): Promise<void> {
    const missing = videos.filter((video) => !this.blurbs[video.id]);
    if (!missing.length) return;
    const lines = await this.deps.blurbs.write(missing.map((video) => ({ id: video.id, title: video.title, description: video.description })));
    const at = new Date().toISOString();
    const source = this.deps.blurbs.mode === 'openai' ? 'ai' : 'template';
    for (const video of missing) {
      const text = lines.get(video.id);
      if (text) this.blurbs[video.id] = { text, source, at };
    }
    await this.deps.kv.set(VIDEO_BLURBS_KEY, this.blurbs);
  }

  private toPublic(video: StoredVideo, featuredLabel: string | null = null): PublicVideo {
    return {
      id: video.id,
      title: video.title,
      description: video.description,
      publishedAt: video.publishedAt,
      thumbnail: video.thumbnail,
      url: videoUrl(video.id),
      blurb: this.blurbs[video.id]?.text ?? '',
      featuredLabel,
    };
  }

  /** A curated pick the feed has not listed yet still plays: its label stands in for the title. */
  private placeholder(pick: FeaturedVideo): PublicVideo {
    return {
      id: pick.id,
      title: pick.label,
      description: '',
      publishedAt: null,
      thumbnail: thumbnailUrl(pick.id),
      url: videoUrl(pick.id),
      blurb: this.blurbs[pick.id]?.text ?? '',
      featuredLabel: pick.label,
    };
  }

  async list(query: { page: number; limit: number }, lang: AppLang = 'ar'): Promise<VideosPage> {
    const content = await getVideosContent(this.deps.kv, lang);
    const byId = new Map(this.snapshot.videos.map((video) => [video.id, video]));
    const featured = content.featured.filter((pick) => isVideoId(pick.id)).map((pick) => {
      const video = byId.get(pick.id);
      return video ? this.toPublic(video, pick.label) : this.placeholder(pick);
    });
    const start = (query.page - 1) * query.limit;
    const items = this.snapshot.videos.slice(start, start + query.limit).map((video) => this.toPublic(video));
    return {
      title: content.title,
      intro: content.intro,
      channelUrl: this.snapshot.channel?.url ?? content.channelUrl,
      featuredTitle: content.featuredTitle,
      featured,
      items,
      page: query.page,
      limit: query.limit,
      total: this.snapshot.videos.length,
      hasMore: start + items.length < this.snapshot.videos.length,
      updatedAt: this.snapshot.fetchedAt,
    };
  }

  async get(id: string, lang: AppLang = 'ar'): Promise<PublicVideo | null> {
    const video = this.snapshot.videos.find((entry) => entry.id === id);
    if (video) return this.toPublic(video);
    const content = await getVideosContent(this.deps.kv, lang);
    const pick = content.featured.find((entry) => entry.id === id);
    return pick ? this.placeholder(pick) : null;
  }
}
