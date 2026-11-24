// M270: puts the owner's prepared photos into the dashboard image slots, the way the dashboard itself does
// (upload ticket → send the file → save the slot). Reads the manifest written beside the prepared pictures.
//
//   node scripts/m270-photos.mjs [prod] [--dry-run] [--dir "<folder>"]
//
// It never replaces a picture the owner already uploaded: a filled slot is left alone. Two slot words mean
// "the first EMPTY slot" and are resolved on each server: `service.<key>` (that service's page banner) and
// `hq` (the HQ gallery). What such a word was given is remembered in `placed.<test|prod>.json` beside the
// manifest, so running the script again never places the same picture twice.
// The server it talks to must already run the M270 code (the new slots exist only there).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { adminCall, API, API_PROD } from './admin-session.mjs';

const args = process.argv.slice(2);
const api = args.includes('prod') ? API_PROD : API;
const dryRun = args.includes('--dry-run');
const dirAt = args.indexOf('--dir');
const dir = dirAt >= 0 ? args[dirAt + 1] : 'C:/Users/LENOVO/OneDrive/Desktop/صور التطبيق الجديد/جاهزة للتطبيق';
const MAX_SLOTS = 12;

// `adminCall` answers the parsed body and throws on any refusal (it signs in again once on a 401).
const call = (pathname, options) => adminCall(pathname, options, api);

/** Uploads one file and returns its public address. */
async function upload(file) {
  const bytes = await readFile(path.join(dir, file));
  const ticket = await call('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ filename: file, contentType: 'image/webp', size: bytes.length }) });
  // Two kinds of ticket, as in the dashboard (admin/src/api.ts `transfer`): a bucket takes a form whose policy
  // fields come first and the file last; the disk store takes the bytes in a PUT.
  let request;
  if (ticket.upload.method === 'POST') {
    const form = new FormData();
    for (const [name, value] of Object.entries(ticket.upload.fields)) form.append(name, value);
    form.append('file', new Blob([bytes], { type: 'image/webp' }), file);
    request = { method: 'POST', body: form };
  } else {
    request = { method: 'PUT', headers: ticket.upload.headers, body: bytes };
  }
  const put = await fetch(ticket.upload.url, { ...request, signal: AbortSignal.timeout(60000) });
  if (!put.ok) throw new Error(`upload of ${file}: ${put.status}`);
  return ticket.url;
}

const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
const { slots } = await call('/api/admin/content/images');
const byKey = new Map(slots.map((slot) => [slot.key, slot]));
if (!byKey.has('home.slide.membership.1')) throw new Error('this server does not carry the M270 slots yet: deploy it first');

const placedFile = path.join(dir, `placed.${api === API_PROD ? 'prod' : 'test'}.json`);
const placed = JSON.parse(await readFile(placedFile, 'utf8').catch(() => '{}'));

/** The slot keys a "first empty slot" word may take, in order; null for an exact key. */
function candidates(word) {
  if (word === 'hq') return Array.from({ length: MAX_SLOTS }, (_, index) => `hq.${index + 1}`);
  if (/^service\.[^.]+$/.test(word)) return [word, ...Array.from({ length: MAX_SLOTS - 1 }, (_, index) => `${word}.${index + 2}`)];
  return null;
}

const taken = new Set();
/** The slot a manifest row gets for one of its slot words: `{ slot }`, or `{ why }` when it gets none. */
function target(file, word) {
  const list = candidates(word);
  if (!list) {
    const slot = byKey.get(word);
    if (!slot) return { why: 'no such slot on this server' };
    return slot.url ? { why: 'already filled' } : { slot };
  }
  if (placed[`${file}>${word}`]) return { why: `placed before in ${placed[`${file}>${word}`]}` };
  for (const key of list) {
    const slot = byKey.get(key);
    if (slot && !slot.url && !slot.urlEn && !taken.has(key)) {
      taken.add(key);
      return { slot };
    }
  }
  return { why: 'no empty slot' };
}

let saved = 0;
for (const row of manifest) {
  const uploaded = {};
  for (const word of row.slots) {
    const { slot, why } = target(row.file, word);
    if (!slot) { console.log(`keep  ${word}: ${why}`); continue; }
    for (const [lang, file] of [['ar', row.file], ['en', row.fileEn]]) {
      if (!file) continue;
      if (dryRun) { console.log(`would ${slot.key} (${lang}) ← ${file}`); continue; }
      uploaded[file] ??= await upload(file);
      await call('/api/admin/content/image', { method: 'PUT', body: JSON.stringify({ key: slot.key, url: uploaded[file], lang }) });
      saved += 1;
      console.log(`saved ${slot.key} (${lang}) ← ${file}`);
    }
    if (!dryRun && candidates(word)) {
      placed[`${row.file}>${word}`] = slot.key;
      await writeFile(placedFile, `${JSON.stringify(placed, null, 2)}\n`, 'utf8');
    }
  }
}
console.log(dryRun ? 'dry run: nothing was sent' : `done: ${saved} slot pictures saved on ${api === API_PROD ? 'PRODUCTION' : 'the test server'}`);
