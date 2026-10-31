// M171 (owner, 2026-10-31): move the production Postgres from Railway US West to EU West.
// The whole server state is ONE table (`kv`, see src/store.ts), so the move is a row copy.
//
//   node server/scripts/m171-copy-kv.mjs copy     # full copy OLD -> NEW (upsert, newer updated_at wins)
//   node server/scripts/m171-copy-kv.mjs delta    # same, only rows the OLD side changed after the last copy
//   node server/scripts/m171-copy-kv.mjs verify   # counts + a content hash on both sides, nothing written
//
// Connection strings come ONLY from the environment (never on the command line, never printed):
//   M171_OLD_URL = the current (US West) DATABASE_PUBLIC_URL, M171_NEW_URL = the new (EU) one.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';

const require = createRequire(new URL('../package.json', import.meta.url));
const pg = require('pg');

const MIGRATION = `CREATE TABLE IF NOT EXISTS kv (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());`;
const MARK = new URL('../.env.m171-last-copy.local', import.meta.url); // git-ignored (.env.*)
const mode = process.argv[2];
if (!['copy', 'delta', 'verify'].includes(mode)) {
  console.error('usage: node m171-copy-kv.mjs copy|delta|verify   (M171_OLD_URL + M171_NEW_URL in the environment)');
  process.exit(2);
}
// The two URLs: from the environment, else from the git-ignored server/.env.m171.local (one KEY=value per line).
const fileVars = {};
for (const line of (await readFile(new URL('../.env.m171.local', import.meta.url), 'utf8').catch(() => '')).split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.+)$/.exec(line.trim().replace(/^﻿/, ''));
  if (m) fileVars[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const oldUrl = process.env.M171_OLD_URL || fileVars.M171_OLD_URL;
const newUrl = process.env.M171_NEW_URL || fileVars.M171_NEW_URL;
if (!oldUrl || !newUrl) {
  console.error('set M171_OLD_URL and M171_NEW_URL (environment or server/.env.m171.local) first');
  process.exit(2);
}
const client = (url) => new pg.Client({ connectionString: url, ssl: /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: false }, statement_timeout: 120_000 });

async function summary(db, label) {
  const { rows } = await db.query('SELECT count(*)::int AS n, max(updated_at) AS latest FROM kv');
  const all = await db.query('SELECT key, value::text AS value FROM kv ORDER BY key');
  const hash = createHash('sha256');
  for (const row of all.rows) hash.update(row.key).update('\u0000').update(row.value).update('\u0001');
  const digest = hash.digest('hex').slice(0, 16);
  console.log(`${label}: ${rows[0].n} rows, latest change ${rows[0].latest ? new Date(rows[0].latest).toISOString() : '-'}, content ${digest}`);
  return { n: rows[0].n, digest };
}

const from = client(oldUrl);
const to = client(newUrl);
await from.connect();
await to.connect();
try {
  await to.query(MIGRATION);
  if (mode === 'verify') {
    const a = await summary(from, 'OLD (US West)');
    const b = await summary(to, 'NEW (EU)');
    console.log(a.n === b.n && a.digest === b.digest ? 'IDENTICAL ✓' : 'DIFFERENT ✗ — run delta (or copy) again');
  } else {
    let since = null;
    if (mode === 'delta') {
      since = (await readFile(MARK, 'utf8').catch(() => '')).trim() || null;
      if (!since) throw new Error('no previous copy recorded: run copy first');
    }
    const startedAt = new Date().toISOString();
    const { rows } = since
      ? await from.query('SELECT key, value, updated_at FROM kv WHERE updated_at >= $1::timestamptz - interval \'2 minutes\' ORDER BY key', [since])
      : await from.query('SELECT key, value, updated_at FROM kv ORDER BY key');
    let written = 0;
    await to.query('BEGIN');
    for (const row of rows) {
      // A row the NEW side changed later (after the switch) is never overwritten by an older OLD copy.
      const result = await to.query(
        `INSERT INTO kv (key, value, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
         WHERE kv.updated_at < EXCLUDED.updated_at`,
        [row.key, row.value, row.updated_at],
      );
      written += result.rowCount ?? 0;
    }
    await to.query('COMMIT');
    await writeFile(MARK, `${startedAt}\n`, 'utf8');
    console.log(`${mode}: read ${rows.length} rows from OLD, wrote ${written} on NEW (started ${startedAt})`);
    const a = await summary(from, 'OLD (US West)');
    const b = await summary(to, 'NEW (EU)');
    console.log(a.n === b.n && a.digest === b.digest ? 'IDENTICAL ✓' : 'DIFFERENT (expected while the OLD side is still being written to) — run delta after the switch');
  }
} finally {
  await from.end();
  await to.end();
}
