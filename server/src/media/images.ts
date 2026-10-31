import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';

import type { MediaStore } from './store.js';

/**
 * M169 (owner, 2026-10-31, «اضغط الصور خليها 10 كيلوبايت… عايز سرعة»): the posts, services, agenda and
 * people pictures used to reach the phone as the uploaded originals (up to 1 MB each, 67 of them behind
 * the home screen) over two hops (a 302 to a presigned bucket link that changed every ten minutes, so
 * iPhones re-downloaded everything). Now `/media/<key>?w=<width>` answers a WebP resized to one of a few
 * widths, encoded once, kept in memory and in the bucket under `variants/`, and sent straight from this
 * server with a one-year immutable cache header — the phone downloads each picture once.
 */
export const VARIANT_WIDTHS = [160, 320, 480, 640, 960, 1280] as const;
/** A link without `?w=` (older bundles, the dashboard) gets this: still sharp on any phone, a tenth of the bytes. */
export const DEFAULT_WIDTH = 960;
const VARIANT_PREFIX = 'variants/v1/';
const MEMORY_BYTES = 96 * 1024 * 1024;
const RESIZABLE = new Set(['jpg', 'jpeg', 'png', 'webp']);

export type Variant = { body: Buffer; contentType: 'image/webp'; etag: string };

type SharpModule = typeof import('sharp');

/** The nearest allowed width at or above the asked one; the default when nothing sensible was asked. */
export function pickWidth(raw: unknown): number {
  const asked = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(asked) || asked <= 0) return DEFAULT_WIDTH;
  return VARIANT_WIDTHS.find((width) => width >= asked) ?? 1280;
}

/** Small tiles can take a harder squeeze than a full-width hero; the owner prefers tiny over pristine. */
export function qualityFor(width: number): number {
  return width <= 480 ? 52 : width <= 960 ? 56 : 60;
}

export class ImageVariants {
  /** Insertion order doubles as the LRU order: a hit is deleted and re-set. */
  private readonly memory = new Map<string, Buffer>();
  private bytes = 0;
  private readonly pending = new Map<string, Promise<Variant | null>>();
  private produced = 0;

  private constructor(
    private readonly store: MediaStore,
    private readonly sharp: SharpModule,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Null (variants off, the old redirect answers) when sharp's native part cannot load on this machine. */
  static async create(store: MediaStore, log: FastifyBaseLogger): Promise<ImageVariants | null> {
    try {
      const mod = await import('sharp');
      return new ImageVariants(store, mod.default, log);
    } catch (error) {
      log.warn({ err: error }, 'image variants off: sharp could not load');
      return null;
    }
  }

  static resizable(key: string): boolean {
    return RESIZABLE.has(key.split('.').pop()?.toLowerCase() ?? '');
  }

  /** Outside `posts/`, so the orphan sweep never lists it; the width is in the name, the format is always WebP. */
  static variantKey(key: string, width: number): string {
    return `${VARIANT_PREFIX}${key.replace(/\.[a-z0-9]+$/i, '')}.w${width}.webp`;
  }

  async get(key: string, width: number): Promise<Variant | null> {
    const id = ImageVariants.variantKey(key, width);
    const etag = `"${createHash('sha1').update(id).digest('base64url').slice(0, 16)}"`;
    const hit = this.memory.get(id);
    if (hit) {
      this.memory.delete(id);
      this.memory.set(id, hit);
      return { body: hit, contentType: 'image/webp', etag };
    }
    let job = this.pending.get(id);
    if (!job) {
      job = this.produce(key, width, id, etag).finally(() => this.pending.delete(id));
      this.pending.set(id, job);
    }
    return job;
  }

  private async produce(key: string, width: number, id: string, etag: string): Promise<Variant | null> {
    const stored = await this.store.read(id).catch(() => null);
    if (stored) {
      this.remember(id, stored.body);
      return { body: stored.body, contentType: 'image/webp', etag };
    }
    const original = await this.store.read(key).catch((error: unknown) => {
      this.log.warn({ err: error, key }, 'image variant: the original could not be read');
      return null;
    });
    if (!original) return null;
    let body: Buffer;
    try {
      body = await this.sharp(original.body, { failOn: 'none', animated: false })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: qualityFor(width), effort: 4 })
        .toBuffer();
    } catch (error) {
      this.log.warn({ err: error, key }, 'image variant: encoding failed, the original is served');
      return null;
    }
    this.produced += 1;
    this.remember(id, body);
    void this.store.put(id, body, 'image/webp').catch((error: unknown) => this.log.warn({ err: error, key: id }, 'image variant: not stored, kept in memory'));
    return { body, contentType: 'image/webp', etag };
  }

  private remember(id: string, body: Buffer): void {
    const previous = this.memory.get(id);
    if (previous) this.bytes -= previous.length;
    this.memory.delete(id);
    this.memory.set(id, body);
    this.bytes += body.length;
    for (const [oldest, buffer] of this.memory) {
      if (this.bytes <= MEMORY_BYTES) break;
      this.memory.delete(oldest);
      this.bytes -= buffer.length;
    }
  }

  status(): Record<string, unknown> {
    return { entries: this.memory.size, bytes: this.bytes, produced: this.produced };
  }
}
