import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';

import { BACKUP_ADMIN_UUID_KEY, BackupService, type SftpLike } from './backup/service.js';
import type { HubBody, HubClient, HubResponse } from './hub/types.js';
import type { MediaObject, MediaStore } from './media/store.js';
import { MemoryKV } from './store.js';

const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return log; }, level: 'silent' } as never;

function fakeSftp() {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  const sftp: SftpLike = {
    async connect() { return undefined; },
    async exists(path) { return dirs.has(path) ? 'd' : files.has(path) ? '-' : false; },
    async mkdir(path) { dirs.add(path); return path; },
    async put(input, remote) {
      if (Buffer.isBuffer(input)) files.set(remote, input);
      else {
        const chunks: Buffer[] = [];
        for await (const chunk of input) chunks.push(Buffer.from(chunk));
        files.set(remote, Buffer.concat(chunks));
      }
      return remote;
    },
    async list(path) {
      const prefix = `${path}/`;
      return [...files.keys()]
        .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map((key) => ({ type: '-', name: key.slice(prefix.length), modifyTime: Date.now() }));
    },
    async delete(path) { files.delete(path); return path; },
    async end() { return undefined; },
  };
  return { sftp, files, dirs };
}

function fakeMedia(objects: Array<{ key: string; body: string; modifiedAt: Date }>): MediaStore {
  return {
    mode: 'disk',
    durable: false,
    async ticket() { throw new Error('unused'); },
    async head() { return null; },
    async read() { return null; },
    async put() {},
    async locate(key) {
      const found = objects.find((object) => object.key === key);
      if (!found) return null;
      // A data: URL keeps the test off the network while exercising the fetch path.
      return { redirect: `data:text/plain;base64,${Buffer.from(found.body).toString('base64')}` };
    },
    async remove() {},
    async list(): Promise<MediaObject[]> { return objects.map(({ key, modifiedAt }) => ({ key, modifiedAt })); },
    status() { return {}; },
  };
}

test('backup run snapshots the kv table and mirrors new media once', async () => {
  const kv = new MemoryKV();
  await kv.set('content:home', { hero: 'العلاقات لا تُقدَّر بثمن' });
  const media = fakeMedia([{ key: 'uploads/a.txt', body: 'hello', modifiedAt: new Date('2026-10-01T00:00:00Z') }]);
  const { sftp, files, dirs } = fakeSftp();
  const service = new BackupService({
    kv,
    media,
    log,
    envName: 'test',
    target: { host: 'h', port: 1, username: 'u', privateKey: 'k' },
    dir: 'backups-club',
    intervalHours: 0,
    retentionDays: 14,
    sftpFactory: () => sftp,
  });

  const first = await service.run();
  assert.equal(first.lastError, null);
  assert.ok(first.lastOk);
  assert.equal(first.db?.keys, 1);
  assert.equal(first.media?.uploaded, 1);
  assert.ok(dirs.has('backups-club/test/db'));
  const dbFile = [...files.keys()].find((key) => key.startsWith('backups-club/test/db/kv-'));
  assert.ok(dbFile, 'db snapshot written');
  const parsed = JSON.parse(gunzipSync(files.get(dbFile!)!).toString('utf8'));
  assert.equal(parsed.rows[0].key, 'content:home');
  assert.equal(files.get('backups-club/test/media/uploads/a.txt')!.toString('utf8'), 'hello');

  // Second run: nothing changed, the mirror skips the object instead of re-uploading it.
  const second = await service.run();
  assert.equal(second.media?.uploaded, 0);
  assert.equal(second.media?.skipped, 1);
});

test('M130: the members export dumps the hub registry with the remembered admin uuid', async () => {
  const kv = new MemoryKV();
  const calls: HubBody[] = [];
  const hub: HubClient = {
    mode: 'mock',
    async call(op, body): Promise<HubResponse> {
      assert.equal(op, 'admin_accounts');
      calls.push(body);
      const page = Number(body.page);
      // Page 1 is full (100 rows), page 2 is short — the export must stop there.
      const size = page === 1 ? 100 : 2;
      const items = Array.from({ length: size }, (_, index) => ({ id: (page - 1) * 100 + index + 1, name: `عضو ${index}`, email: 'a@b.c' }));
      return { ok: true, total: 102, page, per_page: 100, items } as unknown as HubResponse;
    },
  };
  const { sftp, files } = fakeSftp();
  const service = new BackupService({
    kv,
    media: null,
    hub,
    log,
    envName: 'test',
    target: { host: 'h', port: 1, username: 'u', privateKey: 'k' },
    dir: 'backups-club',
    intervalHours: 0,
    retentionDays: 14,
    sftpFactory: () => sftp,
  });

  // No remembered admin yet: the run lands, the members status says what is missing.
  const before = await service.run();
  assert.equal(before.lastError, null);
  assert.equal(before.members?.error, 'no_admin_uuid');
  assert.ok(![...files.keys()].some((key) => key.includes('/members-')));

  service.rememberAdmin('admin-uuid-1');
  await new Promise((resolve) => setImmediate(resolve));
  const after = await service.run();
  assert.equal(after.lastError, null);
  assert.equal(after.members?.error, null);
  assert.equal(after.members?.total, 102);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.uuid, 'admin-uuid-1');
  const membersFile = [...files.keys()].find((key) => key.startsWith('backups-club/test/db/members-'));
  assert.ok(membersFile, 'members snapshot written');
  const parsed = JSON.parse(gunzipSync(files.get(membersFile!)!).toString('utf8')) as { total: number; items: { id: number }[] };
  assert.equal(parsed.total, 102);
  assert.equal(parsed.items[101]?.id, 102);
  assert.ok((await kv.get<{ uuid: string }>(BACKUP_ADMIN_UUID_KEY))?.uuid === 'admin-uuid-1');
});

test('backup without a target stays disabled and never throws', async () => {
  const service = new BackupService({
    kv: new MemoryKV(),
    media: null,
    log,
    envName: 'test',
    target: null,
    dir: 'backups-club',
    intervalHours: 24,
    retentionDays: 14,
  });
  service.start();
  const status = await service.run();
  assert.equal(status.enabled, false);
  assert.equal(status.lastRun, null);
  service.stop();
});
