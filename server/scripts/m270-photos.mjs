// M270: puts the owner's prepared photos into the dashboard image slots, the way the dashboard itself does
// (upload ticket → PUT the file → save the slot). Reads the manifest written beside the prepared pictures.
//
//   node scripts/m270-photos.mjs [prod] [--dry-run] [--dir "<folder>"]
//
// It never replaces a picture the owner already uploaded: a slot that is filled is left alone, and a manifest
// row whose slot is a service banner (`service.<key>`) takes that service's first EMPTY banner slot.
// The server it talks to must already run the M270 code (the new slots exist only there).
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { adminCall, API, API_PROD } from './admin-session.mjs';

const args = process.argv.slice(2);
const api = args.includes('prod') ? API_PROD : API;
const dryRun = args.includes('--dry-run');
const dirAt = args.indexOf('--dir');
const dir = dirAt >= 0 ? args[dirAt + 1] : 'C:/Users/LENOVO/OneDrive/Desktop/صور التطبيق الجديد/جاهزة للتطبيق';

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

/** `service.<key>` → that service's first empty banner slot (and it is taken for the rest of the run). */
const taken = new Set();
function target(key) {
  if (!/^service\.[^.]+$/.test(key)) return byKey.get(key) ?? null;
  for (const candidate of [key, ...[2, 3, 4, 5, 6].map((n) => `${key}.${n}`)]) {
    const slot = byKey.get(candidate);
    if (slot && !slot.url && !slot.urlEn && !taken.has(candidate)) {
      taken.add(candidate);
      return slot;
    }
  }
  return null;
}

let saved = 0;
for (const row of manifest) {
  const uploaded = {};
  for (const wanted of row.slots) {
    const slot = target(wanted);
    if (!slot) { console.log(`skip  ${wanted}: no empty slot`); continue; }
    // A slot that already holds the owner's own picture keeps it, and takes no English twin of OURS either:
    // the English app would otherwise show a different picture from the Arabic one.
    if (slot.url) { console.log(`keep  ${slot.key}: already filled`); continue; }
    for (const [lang, file, current] of [['ar', row.file, slot.url], ['en', row.fileEn, slot.urlEn]]) {
      if (!file) continue;
      if (current) { console.log(`keep  ${slot.key} (${lang}): already filled`); continue; }
      if (dryRun) { console.log(`would ${slot.key} (${lang}) ← ${file}`); continue; }
      uploaded[file] ??= await upload(file);
      await call('/api/admin/content/image', { method: 'PUT', body: JSON.stringify({ key: slot.key, url: uploaded[file], lang }) });
      saved += 1;
      console.log(`saved ${slot.key} (${lang}) ← ${file}`);
    }
  }
}
console.log(dryRun ? 'dry run: nothing was sent' : `done: ${saved} slot pictures saved on ${api === API_PROD ? 'PRODUCTION' : 'the test server'}`);
