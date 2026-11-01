// M176 (owner, 2026-11-01): «اصنع ملتقاك» is a stage service — its banner must show the theater
// (photo 8: the hall with the INVESTOR seats), never the podcast-studio still that sat there.
// Usage (after `node scripts/admin-session.mjs dashboard-ask prod`): node scripts/m176-stage-photo.mjs [prod]
import { readFile } from 'node:fs/promises';

import { adminCall, API, API_PROD } from './admin-session.mjs';

const api = process.argv[2] === 'prod' ? API_PROD : API;
const PHOTO = 'C:/Projects/vibes-club-app/docs/assets/owner-media-2026-10-16/8.webp';

const { slots } = await adminCall('/api/admin/content/images', {}, api);
const meetup = slots.filter((slot) => slot.key === 'service.meetup' || slot.key.startsWith('service.meetup.'));
console.log('meetup slots:', meetup.map((slot) => `${slot.key}=${slot.url ? 'set' : 'empty'}`).join(', '));

const bytes = await readFile(PHOTO);
const { url, upload } = await adminCall('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ filename: 'stage-hall.webp', contentType: 'image/webp', size: bytes.length }) }, api);
if (upload.method === 'PUT') {
  const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
  if (!put.ok) throw new Error(`upload PUT -> ${put.status}`);
} else {
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
  form.append('file', new Blob([bytes], { type: 'image/webp' }), 'stage-hall.webp');
  const post = await fetch(upload.url, { method: 'POST', body: form });
  if (!post.ok) throw new Error(`upload POST -> ${post.status}`);
}

// The stage photo leads; the extra banner slots are cleared so the studio still cannot rotate back in.
await adminCall('/api/admin/content/image', { method: 'PUT', body: JSON.stringify({ key: 'service.meetup', url }) }, api);
for (const slot of meetup) {
  if (slot.key !== 'service.meetup' && slot.url) await adminCall('/api/admin/content/image', { method: 'PUT', body: JSON.stringify({ key: slot.key, url: null }) }, api);
}
console.log('OK service.meetup <- stage hall photo');
