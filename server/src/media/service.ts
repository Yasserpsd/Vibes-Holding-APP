import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { RequestError } from '../auth/guard.js';
import type { MediaLocation, MediaStore, UploadTicket } from './store.js';

export type MediaKind = 'image' | 'video';

// `stored`: phones record QuickTime (.mov); Android's browser refuses that label but plays the same H.264 bytes as MP4.
const TYPES: Record<string, { kind: MediaKind; extension: string; stored?: string }> = {
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/png': { kind: 'image', extension: 'png' },
  'image/webp': { kind: 'image', extension: 'webp' },
  'image/gif': { kind: 'image', extension: 'gif' },
  'video/mp4': { kind: 'video', extension: 'mp4' },
  'video/quicktime': { kind: 'video', extension: 'mp4', stored: 'video/mp4' },
  'video/webm': { kind: 'video', extension: 'webm' },
};
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm']);

/** Keys are made here and nowhere else, so a key that matches can never leave its folder. */
const KEY_PATTERN = /^posts\/\d{4}\/\d{2}\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|png|webp|gif|mp4|mov|webm)$/;
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

export type Upload = { key: string; url: string; kind: MediaKind; upload: UploadTicket };

export type MediaOptions = {
  store: MediaStore;
  /** Origins this server is reached at; a media URL belongs to us only under one of them. */
  origins: string[];
  maxImageBytes: number;
  maxVideoBytes: number;
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
  return VIDEO_EXTENSIONS.has(key.split('.').pop() ?? '') ? 'video' : 'image';
}

/** Uploaded media of the dashboard (M15): upload tickets, the public `/media/<key>` links and clean-up. */
export class MediaService {
  private timers: NodeJS.Timeout[] = [];
  private swept: { at: string; removed: number } | null = null;

  constructor(private readonly options: MediaOptions) {}

  get store(): MediaStore {
    return this.options.store;
  }

  private limit(kind: MediaKind): number {
    return kind === 'image' ? this.options.maxImageBytes : this.options.maxVideoBytes;
  }

  config() {
    const types = (kind: MediaKind) => Object.keys(TYPES).filter((type) => TYPES[type]?.kind === kind);
    return {
      images: { types: types('image'), maxBytes: this.options.maxImageBytes },
      videos: { types: types('video'), maxBytes: this.options.maxVideoBytes },
      durable: this.store.durable,
    };
  }

  urlFor(key: string): string {
    return `${this.options.origins[0]}/media/${key}`;
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
      throw new RequestError('unsupported_type', 'نوع الملف غير مدعوم: الصور بصيغة JPG أو PNG أو WebP أو GIF، والفيديو بصيغة MP4 أو MOV أو WebM');
    }
    const max = this.limit(type.kind);
    if (input.size > max) {
      throw new RequestError('too_large', `حجم ${type.kind === 'image' ? 'الصورة' : 'الفيديو'} أكبر من الحد المسموح (${megabytes(max)} ميجابايت)`);
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
    const key = this.keyOf(url);
    const label = kind === 'image' ? 'الصورة' : 'الفيديو';
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
    return { ...this.store.status(), enabled: this.options.enabled, sweep: this.options.sweepEnabled, maxImageMb: megabytes(this.options.maxImageBytes), maxVideoMb: megabytes(this.options.maxVideoBytes), swept: this.swept };
  }
}
