import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { RequestError } from '../auth/guard.js';
import { isStreamId, type BunnyStream, type StreamFile, type StreamTicket } from './bunny.js';
import type { MediaLocation, MediaStore, UploadTicket } from './store.js';

export type MediaKind = 'image' | 'video' | 'document';

// `stored`: phones record QuickTime (.mov); Android's browser refuses that label but plays the same H.264 bytes as MP4.
const TYPES: Record<string, { kind: MediaKind; extension: string; stored?: string }> = {
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/png': { kind: 'image', extension: 'png' },
  'image/webp': { kind: 'image', extension: 'webp' },
  'image/gif': { kind: 'image', extension: 'gif' },
  'video/mp4': { kind: 'video', extension: 'mp4' },
  'video/quicktime': { kind: 'video', extension: 'mp4', stored: 'video/mp4' },
  'video/webm': { kind: 'video', extension: 'webm' },
  // M192: the slides a workshop showed, for members only.
  'application/pdf': { kind: 'document', extension: 'pdf' },
};
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm']);

/** Keys are made here and nowhere else, so a key that matches can never leave its folder. */
const KEY_PATTERN = /^posts\/\d{4}\/\d{2}\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|png|webp|gif|mp4|mov|webm|pdf)$/;
const PREFIX = 'posts/';
const ORPHAN_HOURS = 24;
const SWEEP_EVERY_MS = 24 * 60 * 60_000;
const FIRST_SWEEP_MS = 10 * 60_000;

export const uploadInputSchema = z.object({
  filename: z.string().trim().max(300).default(''),
  contentType: z.string().trim().toLowerCase().min(3).max(100),
  size: z.number().int().positive(),
});
export type UploadInput = z.infer<typeof uploadInputSchema>;

export type Upload = { key: string; url: string; kind: MediaKind; upload: UploadTicket | StreamTicket };

export type MediaOptions = {
  store: MediaStore;
  /** Origins this server is reached at; a media URL belongs to us only under one of them. */
  origins: string[];
  maxImageBytes: number;
  maxVideoBytes: number;
  /** M192: PDF files (workshop slides). */
  maxDocumentBytes?: number;
  /** M189: videos go to Bunny Stream (4K, adaptive HLS) when set; images stay in the store. */
  stream?: BunnyStream | null;
  maxStreamBytes?: number;
  /** False in production without a bucket: files on a temporary disk must never look like a working upload. */
  enabled: boolean;
  /** Keys the posts point at right now; everything else is an abandoned upload once it is a day old. */
  referenced: () => Promise<Set<string>>;
  /**
   * The sweep deletes what THIS server's posts do not mention, so it is opt-in: only the one server that owns the
   * bucket and keeps its posts in Postgres may run it (never a local server pointed at the same bucket).
   */
  sweepEnabled: boolean;
  log: FastifyBaseLogger;
};

function megabytes(bytes: number): number {
  return Math.floor(bytes / (1024 * 1024));
}

export function isMediaKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function kindOfKey(key: string): MediaKind {
  const extension = key.split('.').pop() ?? '';
  return extension === 'pdf' ? 'document' : VIDEO_EXTENSIONS.has(extension) ? 'video' : 'image';
}

const LABELS: Record<MediaKind, string> = { image: 'الصورة', video: 'الفيديو', document: 'الملف' };

/** Uploaded media of the dashboard (M15): upload tickets, the public `/media/<key>` links and clean-up. */
export class MediaService {
  private timers: NodeJS.Timeout[] = [];
  /** M191: Bunny videos that only members may play (workshop recordings); the public stream link refuses them. */
  private isPrivateStream: (id: string) => Promise<boolean> = async () => false;
  /** M192: uploaded files only members may open (workshop slides); the public `/media/<key>` link refuses them. */
  private isPrivateKey: (key: string) => Promise<boolean> = async () => false;
  private swept: { at: string; removed: number } | null = null;

  constructor(private readonly options: MediaOptions) {}

  get store(): MediaStore {
    return this.options.store;
  }

  private limit(kind: MediaKind): number {
    if (kind === 'image') return this.options.maxImageBytes;
    if (kind === 'document') return this.options.maxDocumentBytes ?? this.options.maxImageBytes;
    return this.options.stream ? (this.options.maxStreamBytes ?? this.options.maxVideoBytes) : this.options.maxVideoBytes;
  }

  config() {
    const types = (kind: MediaKind) => Object.keys(TYPES).filter((type) => TYPES[type]?.kind === kind);
    return {
      images: { types: types('image'), maxBytes: this.options.maxImageBytes },
      videos: { types: types('video'), maxBytes: this.limit('video') },
      documents: { types: types('document'), maxBytes: this.limit('document') },
      durable: this.store.durable,
      stream: Boolean(this.options.stream),
    };
  }

  urlFor(key: string): string {
    return `${this.options.origins[0]}/media/${key}`;
  }

  /** M189: the stable app link of a Bunny video; `/media/stream/...` redirects to the CDN. */
  streamUrl(id: string, file: StreamFile = 'playlist.m3u8'): string {
    return `${this.options.origins[0]}/media/stream/${id}/${file}`;
  }

  /** The Bunny video id behind one of our stream links (the playlist, or its thumbnail as a poster); null otherwise. */
  streamIdOf(url: string, file: StreamFile = 'playlist.m3u8'): string | null {
    if (!URL.canParse(url)) return null;
    const parsed = new URL(url);
    const match = /^\/media\/stream\/([^/]+)\/([^/]+)$/.exec(parsed.pathname);
    if (!this.options.origins.includes(parsed.origin) || !match?.[1] || match[2] !== file || !isStreamId(match[1])) return null;
    return match[1];
  }

  keepPrivate(streams: (id: string) => Promise<boolean>, keys: (key: string) => Promise<boolean> = async () => false): void {
    this.isPrivateStream = streams;
    this.isPrivateKey = keys;
  }

  isPrivate(key: string): Promise<boolean> {
    return this.isPrivateKey(key);
  }

  /** M192: a short-lived link to a members-only file (the bucket's presigned link; the disk store in development answers its own URL). */
  async memberFileUrl(url: string): Promise<string | null> {
    const key = MediaService.keyInPath(url);
    if (!key) return null;
    const location = await this.store.locate(key);
    if (!location) return null;
    return 'redirect' in location ? location.redirect : this.urlFor(key);
  }

  /** Where `/media/stream/<id>/<file>` sends the player; null when streaming is off, the path is not ours or the video is members-only. */
  async streamRedirect(id: string, file: string): Promise<string | null> {
    if (!this.options.stream || !isStreamId(id) || (file !== 'playlist.m3u8' && file !== 'thumbnail.jpg')) return null;
    if (await this.isPrivateStream(id)) return null;
    return this.options.stream.playbackUrl(id, file);
  }

  /** M191: direct, short-lived CDN links for a member's player (signed when the pull zone has token auth on). */
  memberPlayback(id: string): { url: string; poster: string } | null {
    if (!this.options.stream || !isStreamId(id)) return null;
    return { url: this.options.stream.playbackUrl(id, 'playlist.m3u8'), poster: this.options.stream.playbackUrl(id, 'thumbnail.jpg') };
  }

  /** A Bunny video may be attached once it exists and has a playable resolution. */
  async checkStream(id: string): Promise<void> {
    if (!this.options.stream) throw new RequestError('uploads_unavailable', 'خادم الفيديو غير مفعّل على هذا الخادم', 503);
    const state = await this.options.stream.state(id);
    if (state === 'ready') return;
    if (state === 'waiting') throw new RequestError('media_processing', 'الفيديو قيد المعالجة لدى خادم الفيديو، أعد الحفظ بعد دقيقة');
    throw new RequestError(
      'invalid_media',
      state === 'failed' ? 'تعذّرت معالجة الفيديو، ارفعه من جديد' : 'الفيديو غير موجود في مكتبة النادي على Bunny، أو لم يكتمل رفعه',
    );
  }

  /** The poster a streamed video gets when the admin uploaded none: Bunny's own thumbnail. */
  posterFor(videoUrl: string): string | null {
    const id = this.streamIdOf(videoUrl);
    return id ? this.streamUrl(id, 'thumbnail.jpg') : null;
  }

  /** The key in any URL shaped like a media link, whatever its host: a changed public domain must not orphan old posts' files. */
  static keyInPath(url: string): string | null {
    if (!URL.canParse(url)) return null;
    const { pathname } = new URL(url);
    const key = pathname.startsWith('/media/') ? pathname.slice('/media/'.length) : '';
    return isMediaKey(key) ? key : null;
  }

  /** The key behind one of our media URLs; null for any other URL. */
  keyOf(url: string): string | null {
    if (!URL.canParse(url)) return null;
    const parsed = new URL(url);
    if (!this.options.origins.includes(parsed.origin) || !parsed.pathname.startsWith('/media/')) return null;
    const key = parsed.pathname.slice('/media/'.length);
    return isMediaKey(key) ? key : null;
  }

  async createUpload(input: UploadInput, now = new Date()): Promise<Upload> {
    if (!this.options.enabled) throw new RequestError('uploads_unavailable', 'رفع الملفات غير مفعّل على هذا الخادم بعد', 503);
    const type = TYPES[input.contentType];
    if (!type) {
      throw new RequestError('unsupported_type', 'نوع الملف غير مدعوم: الصور بصيغة JPG أو PNG أو WebP أو GIF، والفيديو بصيغة MP4 أو MOV أو WebM، والملفات بصيغة PDF');
    }
    const max = this.limit(type.kind);
    if (input.size > max) {
      throw new RequestError('too_large', `حجم ${LABELS[type.kind]} أكبر من الحد المسموح (${megabytes(max)} ميجابايت)`);
    }
    if (type.kind === 'video' && this.options.stream) {
      const id = await this.options.stream.create(input.filename);
      return { key: `stream/${id}`, url: this.streamUrl(id), kind: 'video', upload: this.options.stream.ticket(id, now.getTime()) };
    }
    const month = now.toISOString().slice(0, 7).replace('-', '/');
    const key = `${PREFIX}${month}/${randomUUID()}.${type.extension}`;
    return { key, url: this.urlFor(key), kind: type.kind, upload: await this.store.ticket(key, type.stored ?? input.contentType, max) };
  }

  /**
   * A post may only point at media of ours that really exists, has the expected kind and respects the limit
   * (a bucket policy already enforces the limit; this also covers a file that was never sent).
   */
  async check(url: string, kind: MediaKind): Promise<void> {
    const label = LABELS[kind];
    if (kind === 'image' && this.options.stream && this.streamIdOf(url, 'thumbnail.jpg')) return;
    const streamId = kind === 'video' ? this.streamIdOf(url) : null;
    if (streamId && this.options.stream) return this.checkStream(streamId);
    const key = this.keyOf(url);
    if (!key || kindOfKey(key) !== kind) throw new RequestError('invalid_media', `ملف ${label} غير صالح، ارفعه من جديد`);
    const info = await this.store.head(key);
    if (!info) throw new RequestError('invalid_media', `لم يكتمل رفع ${label}، ارفعه من جديد`);
    if (info.size > this.limit(kind)) {
      throw new RequestError('invalid_media', `حجم ${label} أكبر من الحد المسموح (${megabytes(this.limit(kind))} ميجابايت)`);
    }
  }

  async locate(key: string): Promise<MediaLocation | null> {
    return isMediaKey(key) ? this.store.locate(key) : null;
  }

  /** Best effort: a file that could not be removed is picked up by the next sweep. */
  async discard(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.store.remove(key);
      } catch (error) {
        this.options.log.warn({ err: error, key }, 'media: could not remove a file');
      }
    }
  }

  /**
   * M118b (the night the sweep ate the photos): every media key mentioned ANYWHERE in the kv —
   * people, agenda, image slots, seeds, reviews — plus the posts' own URLs. This is the only
   * «referenced» set the sweep may trust: a file named by any stored document is never an orphan.
   */
  static async referencedEverywhere(kv: { textSearch(needle: string): Promise<string[]> }, postUrls: string[]): Promise<Set<string>> {
    const keys = new Set(postUrls.map((url) => MediaService.keyInPath(url)).filter((key): key is string => key !== null));
    for (const text of await kv.textSearch('/media/')) {
      for (const match of text.matchAll(/\/media\/(posts\/\d{4}\/\d{2}\/[A-Za-z0-9-]+\.[a-z0-9]{2,5})/g)) {
        if (match[1]) keys.add(match[1]);
      }
    }
    return keys;
  }

  /** Removes files no post points at (abandoned uploads), once they are a day old. */
  async sweep(referenced: Set<string>, now = new Date()): Promise<number> {
    const cutoff = now.getTime() - ORPHAN_HOURS * 60 * 60_000;
    const orphans = (await this.store.list(PREFIX)).filter((object) => !referenced.has(object.key) && object.modifiedAt.getTime() < cutoff);
    await this.discard(orphans.map((object) => object.key));
    this.swept = { at: now.toISOString(), removed: orphans.length };
    return orphans.length;
  }

  start(): void {
    if (!this.options.sweepEnabled) return;
    const run = () =>
      void this.options
        .referenced()
        // No post mentions any file: more likely a lost posts document than a bucket full of abandoned uploads, so nothing is deleted.
        .then(async (keys) => {
          if (keys.size === 0) this.options.log.warn('media: sweep skipped, no post references any file');
          else await this.sweep(keys);
        })
        .catch((error: unknown) => this.options.log.warn({ err: error }, 'media: sweep failed'));
    this.timers = [setTimeout(run, FIRST_SWEEP_MS), setInterval(run, SWEEP_EVERY_MS)];
    for (const timer of this.timers) timer.unref();
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  status(): Record<string, unknown> {
    return { ...this.store.status(), stream: this.options.stream?.status() ?? null, enabled: this.options.enabled, sweep: this.options.sweepEnabled, maxImageMb: megabytes(this.options.maxImageBytes), maxVideoMb: megabytes(this.options.maxVideoBytes), swept: this.swept };
  }
}
