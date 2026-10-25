// One-off local check of the M129 backup path against the real Hostinger box (run: npx tsx scripts/backup-e2e.mts).
// Uses the local key file; on Railway the same key arrives base64-encoded in BACKUP_SSH_KEY_B64.
import { readFileSync } from 'node:fs';

import { BackupService } from '../src/backup/service.js';
import { MemoryKV } from '../src/store.js';

const log = { info: console.log, warn: console.warn, error: console.error, debug() {}, trace() {}, fatal: console.error, child() { return log; }, level: 'info' } as never;

const kv = new MemoryKV();
await kv.set('e2e:probe', { note: 'local backup e2e', at: new Date().toISOString() });

const service = new BackupService({
  kv,
  media: null,
  log,
  envName: 'e2e-local',
  target: {
    host: '72.61.152.83',
    port: 65002,
    username: 'u281262976',
    privateKey: readFileSync(new URL('../.ssh-backup-key', import.meta.url), 'utf8'),
  },
  dir: 'backups-club',
  intervalHours: 0,
  retentionDays: 14,
});

const status = await service.run();
console.log(JSON.stringify(status, null, 1));
process.exit(status.lastError ? 1 : 0);
