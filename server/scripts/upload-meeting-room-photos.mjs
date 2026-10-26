// M130 (owner, 2026-10-26): the owner's REAL meeting-room photos into the «حجز قاعة الاجتماعات»
// image slots. Reuses the cached admin session (scripts/admin-session.mjs — never a fresh login).
// Default target is the TEST server; pass --prod for the production server.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { adminCall, API, API_PROD } from './admin-session.mjs';

const api = process.argv.includes('--prod') ? API_PROD : API;
const PHOTOS = 'C:/Projects/vibes-club-app/docs/assets/service-media-2026-10-19';

// The straight-on shot leads; the top-down overview closes.
const PLAN = [
  { file: 'meeting-room-1.jpg', slot: 'service.meeting-room' },
  { file: 'meeting-room-2.jpg', slot: 'service.meeting-room.2' },
];

const slots = await adminCall('/api/admin/content/images', {}, api);
const catalog = new Map((slots.slots ?? slots).map((slot) => [slot.key, slot]));
console.log(`target ${api} — catalog slots:`, catalog.size);

for (const step of PLAN) {
  if (!catalog.has(step.slot)) {
    console.log(`SKIP ${step.slot}: not in the catalog`);
    continue;
  }
  const bytes = await readFile(`${PHOTOS}/${step.file}`);
  const ticket = await adminCall('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ filename: basename(step.file), contentType: 'image/jpeg', size: bytes.length }) }, api);
  const { url: publicUrl, upload } = ticket;
  if (upload.method === 'PUT') {
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
    if (!put.ok) throw new Error(`PUT upload for ${step.slot} -> ${put.status}`);
  } else {
    const form = new FormData();
    for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
    form.append('file', new Blob([bytes], { type: 'image/jpeg' }), basename(step.file));
    const post = await fetch(upload.url, { method: 'POST', body: form });
    if (!post.ok) throw new Error(`POST upload for ${step.slot} -> ${post.status}`);
  }
  await adminCall('/api/admin/content/image', { method: 'PUT', body: JSON.stringify({ key: step.slot, url: publicUrl }) }, api);
  console.log(`OK ${step.slot} <- ${step.file}`);
}

console.log('DONE');
