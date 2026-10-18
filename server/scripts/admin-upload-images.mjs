// M81: upload the owner's 16 photos into the dashboard image slots on the LIVE server.
// Credentials come ONLY from server/.env.admin.local (git-ignored); nothing secret is printed.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const API = 'https://vibes-holding-app-production.up.railway.app';
const PHOTOS = 'C:/Projects/vibes-club-app/docs/assets/owner-media-2026-10-16';
const ENV_FILE = 'C:/Projects/vibes-club-app/server/.env.admin.local';

// photo number -> slot key (slot keys verified against the live catalog before anything uploads)
const PLAN = [
  { photo: 8, slot: 'hq.1' }, // auditorium wide with studio lights
  { photo: 3, slot: 'hq.2' }, // auditorium chair rows
  { photo: 1, slot: 'hq.3' }, // INVESTOR chair close-up
  { photo: 16, slot: 'hq.4' }, // handshake between INVESTOR chairs
  { photo: 2, slot: 'hq.5' }, // podcast studio mics + armchairs
  { photo: 9, slot: 'hq.6' }, // podcast guest still (majlis)
  { photo: 5, slot: 'home.banner' }, // بودكاست الملتقى golden banner
  { photo: 6, slot: 'golden.banner' }, // Golden Projects banner
  { photo: 4, slot: 'about.banner' }, // Riyadh skyline
  { photo: 10, slot: 'service.studio' }, // podcast service page
  { photo: 7, slot: 'service.app-publish' }, // Seka Tech app banner on «انشر تطبيقك»
  { photo: 14, slot: 'service.meetup' }, // stage session still on «اصنع ملتقاك»
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
console.log('logged in as admin:', session.account?.name ?? 'ok');

const slots = await call('/api/admin/content/images', {}, token);
const catalog = new Map((slots.slots ?? slots).map((slot) => [slot.key, slot]));
console.log('catalog slots:', catalog.size);

for (const step of PLAN) {
  const slot = catalog.get(step.slot);
  if (!slot) {
    console.log(`SKIP ${step.slot}: not in the catalog`);
    continue;
  }
  const file = `${PHOTOS}/${step.photo}.webp`;
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
  console.log(`OK ${step.slot} <- photo ${step.photo}.webp`);
}

const after = await call('/api/hq', {});
console.log('hq photos now:', (after.photos ?? []).length);
console.log('DONE');
