// M130 (owner, 2026-10-26 night): the owner's film links per service + the «انشر تطبيقك» banner
// images, applied through the dashboard values/images APIs with the cached admin session.
// Default target is the TEST server; pass --prod for the production server.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { adminCall, API, API_PROD } from './admin-session.mjs';

const api = process.argv.includes('--prod') ? API_PROD : API;
const PHOTOS = 'C:/Projects/vibes-club-app/docs/assets/service-media-2026-10-19';

// The owner's picks, canonicalized to watch URLs (youtu.be shorts expanded).
const FILMS = [
  { key: 'success-partners', url: 'https://www.youtube.com/watch?v=RfzNuS_q1UE' },
  { key: 'workshop', url: 'https://www.youtube.com/watch?v=U7kIYc4ZlGE' },
  { key: 'studio', url: 'https://www.youtube.com/watch?v=6TNxF2cxL4Q' },
  { key: 'theater', url: 'https://www.youtube.com/watch?v=8MuTvxvtnXY' },
];

// «انشر تطبيقك على Android و iOS» — the stores-over-the-globe shot leads.
const IMAGES = [
  { file: 'app-publish-1.webp', slot: 'service.app-publish' },
  { file: 'app-publish-2.webp', slot: 'service.app-publish.2' },
  { file: 'app-publish-3.webp', slot: 'service.app-publish.3' },
];

console.log('target', api);

for (const film of FILMS) {
  const saved = await adminCall('/api/admin/content/value', { method: 'PUT', body: JSON.stringify({ block: 'services', path: `services.${film.key}.videoUrl`, value: film.url }) }, api);
  console.log(`FILM ${film.key} <- ${saved.value}`);
}

const slots = await adminCall('/api/admin/content/images', {}, api);
const catalog = new Map((slots.slots ?? slots).map((slot) => [slot.key, slot]));
for (const step of IMAGES) {
  if (!catalog.has(step.slot)) {
    console.log(`SKIP ${step.slot}: not in the catalog`);
    continue;
  }
  const bytes = await readFile(`${PHOTOS}/${step.file}`);
  const ticket = await adminCall('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ filename: basename(step.file), contentType: 'image/webp', size: bytes.length }) }, api);
  const { url: publicUrl, upload } = ticket;
  if (upload.method === 'PUT') {
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
    if (!put.ok) throw new Error(`PUT upload for ${step.slot} -> ${put.status}`);
  } else {
    const form = new FormData();
    for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
    form.append('file', new Blob([bytes], { type: 'image/webp' }), basename(step.file));
    const post = await fetch(upload.url, { method: 'POST', body: form });
    if (!post.ok) throw new Error(`POST upload for ${step.slot} -> ${post.status}`);
  }
  await adminCall('/api/admin/content/image', { method: 'PUT', body: JSON.stringify({ key: step.slot, url: publicUrl }) }, api);
  console.log(`PHOTO ${step.slot} <- ${step.file}`);
}

console.log('DONE');
