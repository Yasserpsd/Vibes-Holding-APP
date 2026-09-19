import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Where uploaded media lives (M15). The dashboard never sends a file through the JSON API: it asks for an
 * upload ticket and sends the bytes where the ticket says (straight to the bucket, or to this server's
 * disk store in development and tests).
 */
export type UploadTicket =
  | { method: 'POST'; url: string; fields: Record<string, string> }
  | { method: 'PUT'; url: string; headers: Record<string, string> };

export type MediaInfo = { size: number; contentType: string };
export type MediaLocation = { redirect: string } | { path: string; size: number; contentType: string };
export type MediaObject = { key: string; modifiedAt: Date };

export interface MediaStore {
  readonly mode: 's3' | 'disk';
  /** False when the files do not survive a deploy (the disk store on Railway's ephemeral disk). */
  readonly durable: boolean;
  ticket(key: string, contentType: string, maxBytes: number): Promise<UploadTicket>;
  head(key: string): Promise<MediaInfo | null>;
  locate(key: string): Promise<MediaLocation | null>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<MediaObject[]>;
  status(): Record<string, unknown>;
}

export const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

export class UploadTokenError extends Error {}
export class UploadTooLargeError extends Error {}

type PutToken = { key: string; contentType: string; maxBytes: number; expires: number };

const TOKEN_MINUTES = 60;

/**
 * Files under one local folder, for development and tests. Upload tickets point back at this server
 * (`PUT /api/admin/uploads/put?ticket=<token>`); the token is signed with a per-process secret, so it needs no session.
 */
export class DiskMediaStore implements MediaStore {
  readonly mode = 'disk' as const;
  readonly durable = false;
  private readonly root: string;
  private readonly secret = randomBytes(32);

  constructor(
    root: string,
    private readonly publicUrl: string,
  ) {
    this.root = resolve(root);
  }

  private file(key: string): string {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new UploadTokenError('key outside the store');
    return path;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  async ticket(key: string, contentType: string, maxBytes: number): Promise<UploadTicket> {
    const token: PutToken = { key, contentType, maxBytes, expires: Date.now() + TOKEN_MINUTES * 60_000 };
    const payload = Buffer.from(JSON.stringify(token)).toString('base64url');
    return { method: 'PUT', url: `${this.publicUrl}/api/admin/uploads/put?ticket=${payload}.${this.sign(payload)}`, headers: { 'content-type': contentType } };
  }

  /** The ticket behind a PUT token; throws when the token is forged, malformed or expired. */
  readToken(value: string): PutToken {
    const [payload, signature] = value.split('.');
    if (!payload || !signature) throw new UploadTokenError('malformed token');
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new UploadTokenError('bad signature');
    const token = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PutToken;
    if (token.expires < Date.now()) throw new UploadTokenError('expired token');
    return token;
  }

  /** Streams the body to disk; a body over the ticket's limit is cut off and nothing is kept. */
  async write(token: PutToken, body: Readable): Promise<number> {
    const target = this.file(token.key);
    const partial = `${target}.part`;
    await mkdir(dirname(target), { recursive: true });
    let size = 0;
    try {
      await pipeline(
        body,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            size += chunk.length;
            if (size > token.maxBytes) throw new UploadTooLargeError('body over the limit');
            yield chunk;
          }
        },
        createWriteStream(partial),
      );
      if (size === 0) throw new UploadTokenError('empty body');
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
    return size;
  }

  async head(key: string): Promise<MediaInfo | null> {
    const info = await stat(this.file(key)).catch(() => null);
    if (!info?.isFile()) return null;
    return { size: info.size, contentType: EXTENSION_TYPES[key.split('.').pop() ?? ''] ?? 'application/octet-stream' };
  }

  async locate(key: string): Promise<MediaLocation | null> {
    const info = await this.head(key);
    return info ? { path: this.file(key), ...info } : null;
  }

  async remove(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }

  async list(prefix: string): Promise<MediaObject[]> {
    const entries = await readdir(this.root, { recursive: true, withFileTypes: true }).catch(() => []);
    const objects: MediaObject[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith('.part')) continue;
      const path = join(entry.parentPath, entry.name);
      const key = path.slice(this.root.length + 1).split(sep).join('/');
      if (key.startsWith(prefix)) objects.push({ key, modifiedAt: (await stat(path)).mtime });
    }
    return objects;
  }

  open(path: string, range?: { start: number; end: number }): Readable {
    return createReadStream(path, range);
  }

  status(): Record<string, unknown> {
    return { mode: this.mode, durable: this.durable };
  }
}
