import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

import SftpClient from 'ssh2-sftp-client';
import type { FastifyBaseLogger } from 'fastify';

import type { MediaLocation, MediaStore } from '../media/store.js';
import type { KV } from '../store.js';

/**
 * M129 off-site backup («نكون في الأمان»): a scheduled copy of everything this server owns to the
 * owner's own hosting over SFTP, so a Railway loss never takes the club's data with it.
 *
 * - Database: the whole kv table as one gzipped JSON snapshot per run, dated, with retention.
 * - Media: an incremental mirror of the bucket (only new/changed objects are transferred).
 *   Nothing is ever deleted from the mirror: a backup must survive a bad sweep, not copy it.
 *
 * Remote layout: <dir>/<env>/db/kv-<stamp>.json.gz and <dir>/<env>/media/<objectKey>, under the
 * SSH user's home (outside any public_html, so nothing is web-reachable).
 */

export type BackupTarget = {
  host: string;
  port: number;
  username: string;
  /** Raw private key in OpenSSH PEM form (already base64-decoded from the env). */
  privateKey: string;
};

/** The slice of ssh2-sftp-client the service uses; tests pass a fake. */
export type SftpLike = {
  connect(options: Record<string, unknown>): Promise<unknown>;
  exists(path: string): Promise<false | string>;
  mkdir(path: string, recursive?: boolean): Promise<string>;
  put(input: Buffer | Readable, remote: string): Promise<string>;
  list(path: string): Promise<Array<{ type: string; name: string; modifyTime: number }>>;
  delete(path: string): Promise<string>;
  end(): Promise<unknown>;
};

export type BackupOptions = {
  kv: KV;
  media: MediaStore | null;
  log: FastifyBaseLogger;
  /** 'test' | 'production' — keeps the two servers apart under one hosting account. */
  envName: string;
  target: BackupTarget | null;
  dir: string;
  intervalHours: number;
  retentionDays: number;
  fetchImpl?: typeof fetch;
  sftpFactory?: () => SftpLike;
};

export type BackupStatus = {
  enabled: boolean;
  running: boolean;
  lastRun: string | null;
  lastOk: string | null;
  lastError: string | null;
  db: { bytes: number; keys: number } | null;
  media: { total: number; uploaded: number; skipped: number; failed: number } | null;
};

const MANIFEST_KEY = 'backup:media:manifest';
const FIRST_RUN_MS = 3 * 60_000;

type Manifest = Record<string, string>;

export class BackupService {
  private timer: NodeJS.Timeout | null = null;
  private status: BackupStatus;

  constructor(private readonly options: BackupOptions) {
    this.status = {
      enabled: Boolean(options.target),
      running: false,
      lastRun: null,
      lastOk: null,
      lastError: null,
      db: null,
      media: null,
    };
  }

  /** First run a few minutes after boot (lets the services settle), then on the configured interval. */
  start(): void {
    if (!this.options.target || this.options.intervalHours <= 0) return;
    setTimeout(() => void this.run().catch(() => undefined), FIRST_RUN_MS).unref?.();
    this.timer = setInterval(() => void this.run().catch(() => undefined), this.options.intervalHours * 3_600_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getStatus(): BackupStatus {
    return { ...this.status };
  }

  /** One full backup pass. Serialized: a second call while one runs is a no-op. */
  async run(): Promise<BackupStatus> {
    const { target, log } = this.options;
    if (!target) return this.getStatus();
    if (this.status.running) return this.getStatus();
    this.status.running = true;
    this.status.lastRun = new Date().toISOString();
    const sftp: SftpLike = this.options.sftpFactory ? this.options.sftpFactory() : (new SftpClient() as unknown as SftpLike);
    try {
      await sftp.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        privateKey: target.privateKey,
        readyTimeout: 30_000,
      });
      const base = `${this.options.dir}/${this.options.envName}`;
      await this.ensureDir(sftp, `${base}/db`);
      await this.ensureDir(sftp, `${base}/media`);
      await this.backupDb(sftp, base);
      await this.backupMedia(sftp, base);
      await this.prune(sftp, `${base}/db`);
      this.status.lastOk = new Date().toISOString();
      this.status.lastError = null;
      log.info({ db: this.status.db, media: this.status.media }, 'backup: run complete');
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : String(error);
      log.error({ err: error }, 'backup: run failed');
    } finally {
      this.status.running = false;
      await sftp.end().catch(() => undefined);
    }
    return this.getStatus();
  }

  private async ensureDir(sftp: SftpLike, path: string): Promise<void> {
    if (!(await sftp.exists(path))) await sftp.mkdir(path, true);
  }

  private async backupDb(sftp: SftpLike, base: string): Promise<void> {
    const rows = await this.options.kv.dump();
    const body = gzipSync(Buffer.from(JSON.stringify({ takenAt: new Date().toISOString(), rows }), 'utf8'));
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    await sftp.put(body, `${base}/db/kv-${stamp}.json.gz`);
    this.status.db = { bytes: body.length, keys: rows.length };
  }

  private async backupMedia(sftp: SftpLike, base: string): Promise<void> {
    const { media, log } = this.options;
    if (!media) {
      this.status.media = null;
      return;
    }
    const objects = await media.list('');
    const manifest = (await this.options.kv.get<Manifest>(MANIFEST_KEY)) ?? {};
    const counters = { total: objects.length, uploaded: 0, skipped: 0, failed: 0 };
    const madeDirs = new Set<string>();
    for (const object of objects) {
      const seen = manifest[object.key];
      const mtime = object.modifiedAt.toISOString();
      if (seen === mtime) {
        counters.skipped += 1;
        continue;
      }
      try {
        const location = await media.locate(object.key);
        if (!location) continue;
        // Object keys never contain '..' (server-generated uuids/paths), so the join is safe.
        const remote = `${base}/media/${object.key}`;
        const parent = remote.slice(0, remote.lastIndexOf('/'));
        if (!madeDirs.has(parent)) {
          await this.ensureDir(sftp, parent);
          madeDirs.add(parent);
        }
        await sftp.put(await this.open(location), remote);
        manifest[object.key] = mtime;
        counters.uploaded += 1;
      } catch (error) {
        counters.failed += 1;
        log.warn({ err: error, key: object.key }, 'backup: media object failed, will retry next run');
      }
    }
    await this.options.kv.set(MANIFEST_KEY, manifest);
    this.status.media = counters;
  }

  /** A readable for either store flavor: presigned bucket link (s3) or a local file path (disk). */
  private async open(location: MediaLocation): Promise<Readable> {
    if ('redirect' in location) {
      const doFetch = this.options.fetchImpl ?? fetch;
      const response = await doFetch(location.redirect);
      if (!response.ok || !response.body) throw new Error(`media fetch ${response.status}`);
      return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    }
    const { createReadStream } = await import('node:fs');
    return createReadStream(location.path);
  }

  /** Keeps RETENTION_DAYS of database snapshots; the newest 3 survive whatever their age. */
  private async prune(sftp: SftpLike, dbDir: string): Promise<void> {
    const entries = await sftp.list(dbDir);
    const snapshots = entries
      .filter((entry) => entry.type === '-' && entry.name.startsWith('kv-'))
      .sort((a, b) => b.name.localeCompare(a.name));
    const cutoff = Date.now() - this.options.retentionDays * 86_400_000;
    for (const entry of snapshots.slice(3)) {
      if (entry.modifyTime < cutoff) await sftp.delete(`${dbDir}/${entry.name}`).catch(() => undefined);
    }
  }
}
