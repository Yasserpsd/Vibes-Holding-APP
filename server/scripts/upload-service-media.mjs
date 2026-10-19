// M105: upload the owner's service-banner photos (2026-10-19 batch) into the dashboard image
// slots on the LIVE server. Credentials come ONLY from server/.env.admin.local (git-ignored).
// Run AFTER the M105 deploy (the .2–.6 slots must exist in the live catalog).
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const API = 'https://vibes-holding-app-production.up.railway.app';
const PHOTOS = 'C:/Projects/vibes-club-app/docs/assets/service-media-2026-10-19';
const ENV_FILE = 'C:/Projects/vibes-club-app/server/.env.admin.local';

// file (inside PHOTOS) -> slot key. Extended as the owner sends each service's photos.
const PLAN = [
  // حقوق تشغيل نادي المستثمرين — the operational-plan presentation leads, the handshake seals.
  { file: 'operating-rights-1.webp', slot: 'service.operating-rights' },
  { file: 'operating-rights-6.webp', slot: 'service.operating-rights.2' },
  { file: 'operating-rights-2.webp', slot: 'service.operating-rights.3' },
  { file: 'operating-rights-4.webp', slot: 'service.operating-rights.4' },
  { file: 'operating-rights-3.webp', slot: 'service.operating-rights.5' },
  { file: 'operating-rights-5.webp', slot: 'service.operating-rights.6' },
];

async function env() {
  const text = await readFile(ENV_FILE, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z_]+)\s*=\s*(.+)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].trim();
  }
  if (!out.ADMIN_LOGIN || !out.ADMIN_PASSWORD) throw new Error('ADMIN_LOGIN / ADMIN_PASSWORD missing in .env.admin.local');
  return out;
}

async function call(path, options = {}, token) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(body?.error ?? body ?? '')}`);
  return body;
}

const creds = await env();
const session = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: creds.ADMIN_LOGIN, password: creds.ADMIN_PASSWORD }) });
if (session.pending) throw new Error('login answered pending (mail code) — tell Claude');
const token = session.token;
if (!token) throw new Error('no token in the login response');
console.log('logged in as admin');

const slots = await call('/api/admin/content/images', {}, token);
const catalog = new Map((slots.slots ?? slots).map((slot) => [slot.key, slot]));
console.log('catalog slots:', catalog.size);

for (const step of PLAN) {
  if (!catalog.has(step.slot)) {
    console.log(`SKIP ${step.slot}: not in the catalog (deploy M105 first?)`);
    continue;
  }
  const file = `${PHOTOS}/${step.file}`;
  const bytes = await readFile(file);
  const ticketResponse = await call('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ filename: basename(file), contentType: 'image/webp', size: bytes.length }) }, token);
  const { url: publicUrl, upload } = ticketResponse;
  if (upload.method === 'PUT') {
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
    if (!put.ok) throw new Error(`PUT upload for ${step.slot} -> ${put.status}`);
  } else {
    const form = new FormData();
    for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
    form.append('file', new Blob([bytes], { type: 'image/webp' }), basename(file));
    const post = await fetch(upload.url, { method: 'POST', body: form });
    if (!post.ok) throw new Error(`POST upload for ${step.slot} -> ${post.status}`);
  }
  await call('/api/admin/content/image', { method: 'PUT', body: JSON.stringify({ key: step.slot, url: publicUrl }) }, token);
  console.log(`OK ${step.slot} <- ${step.file}`);
}

console.log('DONE');
