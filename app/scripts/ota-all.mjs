// One command for every OTA (owner, 2026-11-16: «كود واحد نكتبه يعدل في كله»).
//
//   npm run ota                publish the committed tree to every production runtime, then preview, then verify
//   npm run ota "message"      same, with an explicit update message (default: the last commit's subject)
//   npm run ota:check          publish nothing; show what every runtime serves right now
//   npm run ota -- --dry-run   publish nothing; run the safety checks and print the commands it would run
//
// Why a script: the runtimes done by hand went wrong in every possible way — a leftover OTA_RUNTIME_VERSION in the
// shell, the interactive environment prompt (a test bundle reached production), a runtime that silently did not
// land, uncommitted work of another session shipped by accident. Here each publish gets its own environment, the
// tree must be committed, and every runtime is read back from u.expo.dev before the script says it is done.
//
// The runtimes live in ../ota-runtimes.json. A version bump in app.config.ts is added to that file by itself.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(appDir, '..');
const runtimesFile = path.join(appDir, 'ota-runtimes.json');

const fail = (message) => {
  console.error(`\nSTOPPED: ${message}`);
  process.exit(1);
};

const config = fs.readFileSync(path.join(appDir, 'app.config.ts'), 'utf8');
const APP_VERSION = (config.match(/const APP_VERSION = '([^']+)'/) ?? [])[1];
const PROJECT_ID = (config.match(/const EAS_PROJECT_ID = '([^']+)'/) ?? [])[1];
if (!APP_VERSION || !PROJECT_ID) fail('could not read APP_VERSION / EAS_PROJECT_ID from app.config.ts');

/** What a healthy update of each channel carries in its manifest. */
const EXPECT = {
  production: { appEnv: 'production', api: 'https://api.vibesholdingsa.com' },
  preview: { appEnv: 'test', api: 'https://api-test.vibesholdingsa.com' },
};

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const allowDirty = args.includes('--allow-dirty');
const dryRun = args.includes('--dry-run');
const words = args.filter((arg) => !arg.startsWith('--'));

// ---- the runtimes -------------------------------------------------------------------------------------------------
const saved = JSON.parse(fs.readFileSync(runtimesFile, 'utf8'));
const unique = (list) => [...new Set(list)];
if (!saved.production.includes(APP_VERSION) && !checkOnly && !dryRun) {
  // A new store version: it joins the list for good (skipping a live runtime leaves its phones without the bundle).
  saved.production = [APP_VERSION, ...saved.production];
  fs.writeFileSync(runtimesFile, `${JSON.stringify(saved, null, 2)}\n`);
  console.log(`NOTE: ${APP_VERSION} was added to app/ota-runtimes.json. Commit that file.`);
}
const targets = [
  ...unique([APP_VERSION, ...saved.production]).map((runtime) => ({ channel: 'production', runtime })),
  ...unique([APP_VERSION, ...(saved.previewExtra ?? [])]).map((runtime) => ({ channel: 'preview', runtime })),
];

// ---- helpers ------------------------------------------------------------------------------------------------------
const logDir = path.join(os.tmpdir(), 'investors-club-ota', new Date().toISOString().replace(/[:.]/g, '-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function git(gitArgs) {
  const result = spawnSync('git', gitArgs, { cwd: repoDir, encoding: 'utf8' });
  if (result.status !== 0) fail(`git ${gitArgs.join(' ')} failed: ${result.stderr || result.error?.message}`);
  return result.stdout;
}

/** Runs the eas CLI in app/ with a clean, per-call environment; its chatter goes to a log file. */
function eas(command, { runtime, log } = {}) {
  const env = { ...process.env };
  delete env.OTA_RUNTIME_VERSION; // never inherited from the shell: this is what bit the owner twice
  if (runtime && runtime !== APP_VERSION) env.OTA_RUNTIME_VERSION = runtime;
  if (!(env.NODE_OPTIONS ?? '').includes('--use-system-ca')) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --use-system-ca`.trim();
  const fd = log ? fs.openSync(log, 'w') : 'ignore';
  // shell: the CLI is a .cmd shim on Windows. Every word of `command` is built here; the message is sanitized.
  const result = spawnSync(`eas ${command}`, { cwd: appDir, shell: true, env, encoding: 'utf8', stdio: ['ignore', 'pipe', fd], maxBuffer: 64 * 1024 * 1024 });
  if (log) fs.closeSync(fd);
  return result;
}

const tail = (file, count) => {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).slice(-count).join('\n');
  } catch {
    return '';
  }
};

/** What u.expo.dev serves right now to a phone of this channel, runtime and platform. */
async function served(channel, runtime, platform) {
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`https://u.expo.dev/${PROJECT_ID}`, {
        headers: {
          accept: 'multipart/mixed, application/expo+json, application/json',
          'expo-platform': platform,
          'expo-runtime-version': runtime,
          'expo-channel-name': channel,
          'expo-protocol-version': '1',
        },
      });
      const text = await response.text();
      const pick = (key) => (text.match(new RegExp(`"${key}":"([^"]*)"`)) ?? [])[1] ?? '';
      return { status: response.status, id: pick('id'), createdAt: pick('createdAt'), appEnv: pick('appEnv'), api: pick('apiBaseUrl').replace(/\/$/, '') };
    } catch (error) {
      lastError = String(error.cause?.code ?? error.message);
      await sleep(2000);
    }
  }
  return { status: 0, id: '', createdAt: '', appEnv: '', api: '', error: lastError };
}

/** Empty when the served update is right; else the reason, in plain words. */
function problemOf(row, channel, platform, published, startedAt) {
  if (row.status === 0) return `could not reach u.expo.dev (${row.error})`;
  if (row.status !== 200 || !row.id) return 'no update is served';
  if (row.appEnv !== EXPECT[channel].appEnv) return `WRONG ENVIRONMENT: appEnv is "${row.appEnv}"`;
  if (row.api !== EXPECT[channel].api) return `WRONG API: ${row.api}`;
  if (!published) return '';
  const id = published.ids[platform];
  if (id ? row.id !== id : Date.parse(row.createdAt) < startedAt - 120_000) return 'still serving the older update';
  return '';
}

function publish(target, message, position) {
  const label = `${target.channel} ${target.runtime}`;
  process.stdout.write(`[${position}] ${label}: publishing, about a minute ... `);
  const log = path.join(logDir, `${target.channel}-${target.runtime}.log`);
  const result = eas(`update --channel ${target.channel} --environment ${target.channel} --non-interactive --json --message "${message}"`, { runtime: target.runtime, log });
  const ids = {};
  try {
    const out = result.stdout ?? '';
    for (const update of JSON.parse(out.slice(out.indexOf('[')))) if (update.platform && update.id) ids[update.platform] = update.id;
  } catch {
    // No readable JSON: the verification falls back to the update's date.
  }
  if (result.status === 0) {
    console.log('published');
    return { ids };
  }
  console.log(`FAILED (full log: ${log})`);
  console.log(tail(log, 12));
  return null;
}

async function verify(target, published, startedAt) {
  const rows = [];
  for (const platform of ['ios', 'android']) {
    let row = await served(target.channel, target.runtime, platform);
    let problem = problemOf(row, target.channel, platform, published, startedAt);
    // A fresh update can take a few seconds to be the one served.
    for (let attempt = 0; attempt < 3 && published && problem === 'still serving the older update'; attempt += 1) {
      await sleep(8000);
      row = await served(target.channel, target.runtime, platform);
      problem = problemOf(row, target.channel, platform, published, startedAt);
    }
    rows.push({ ...target, platform, ...row, problem });
  }
  return rows;
}

function printTable(rows) {
  console.log('');
  for (const row of rows) {
    const cells = [row.channel.padEnd(10), row.runtime.padEnd(6), row.platform.padEnd(7), (row.problem ? 'PROBLEM' : 'OK').padEnd(7), (row.id || '-').slice(0, 8), (row.createdAt || '-').slice(0, 19).padEnd(19), row.appEnv || '-'];
    console.log(`  ${cells.join('  ')}${row.problem ? `   <- ${row.problem}` : ''}`);
  }
  console.log('');
}

// ---- main ---------------------------------------------------------------------------------------------------------
const version = eas('--version');
if (version.status !== 0) fail('the eas CLI did not start. Install it with: npm install -g eas-cli');

if (checkOnly) {
  console.log(`What every runtime serves right now (tree version ${APP_VERSION}):`);
  const rows = [];
  for (const target of targets) rows.push(...(await verify(target, null, 0)));
  printTable(rows);
  // The preview channel may have no update on the current runtime; that alone is not a fault.
  const bad = rows.filter((row) => row.problem && !(row.channel === 'preview' && row.problem === 'no update is served'));
  console.log(bad.length === 0 ? 'CHECK OK.' : `CHECK FOUND ${bad.length} PROBLEM(S).`);
  process.exit(bad.length === 0 ? 0 : 1);
}

// The bundle is exported from the working tree: uncommitted work of any session would ship with it.
const dirty = git(['status', '--porcelain', '--', 'app'])
  .split(/\r?\n/)
  .filter((line) => line.trim() && !line.endsWith('app/ota-runtimes.json'));
if (dirty.length > 0 && !allowDirty) {
  console.error(dirty.join('\n'));
  fail('app/ has uncommitted changes (listed above). Commit them first: an update ships the files as they are on disk.');
}

const message = (words.join(' ') || git(['log', '-1', '--format=%s']))
  .replace(/[^A-Za-z0-9 .,:;_+()/-]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 120);
if (!message) fail('the update message is empty. Run: npm run ota "short english message"');

if (dryRun) {
  console.log(`Update message: ${message}`);
  for (const target of targets) {
    const override = target.runtime === APP_VERSION ? '(no OTA_RUNTIME_VERSION)' : `OTA_RUNTIME_VERSION=${target.runtime}`;
    console.log(`  ${override}  eas update --channel ${target.channel} --environment ${target.channel} --non-interactive --json --message "${message}"`);
  }
  console.log('');
  console.log('DRY RUN: nothing was published.');
  process.exit(0);
}

fs.mkdirSync(logDir, { recursive: true });
const startedAt = Date.now();
console.log(`Update message: ${message}`);
console.log(`Targets: ${targets.map((target) => `${target.channel} ${target.runtime}`).join(', ')}\n`);

const results = new Map();
for (const [index, target] of targets.entries()) {
  const published = publish(target, message, `${index + 1}/${targets.length}`);
  results.set(target, { published, rows: published ? await verify(target, published, startedAt) : [] });
}

// One more try for whatever did not publish or did not land (it happened: 1.2.0, 2026-11-07).
for (const target of targets) {
  const state = results.get(target);
  if (state.published && state.rows.every((row) => !row.problem)) continue;
  // A wrong environment is never retried blindly: the same command would publish the same wrong bundle.
  if (state.rows.some((row) => row.problem.startsWith('WRONG'))) continue;
  const published = publish(target, message, 'retry');
  results.set(target, { published, rows: published ? await verify(target, published, startedAt) : [] });
}

const rows = [];
const failed = [];
for (const target of targets) {
  const state = results.get(target);
  rows.push(...state.rows);
  if (!state.published) failed.push(`${target.channel} ${target.runtime}: the publish failed`);
  for (const row of state.rows) if (row.problem) failed.push(`${row.channel} ${row.runtime} ${row.platform}: ${row.problem}`);
}
printTable(rows);
const minutes = Math.round((Date.now() - startedAt) / 60_000);
if (failed.length === 0) {
  console.log(`ALL GOOD: ${targets.length} updates published and verified in ${minutes} min. Phones take it at their next cold start.`);
  process.exit(0);
}
console.log(`NOT DONE (${minutes} min). Problems:`);
for (const line of failed) console.log(`  - ${line}`);
console.log(`Logs: ${logDir}`);
process.exit(1);
