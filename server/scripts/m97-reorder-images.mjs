// M97: the chairs lead — reassign existing slot URLs (no new uploads).
// home.banner <- hq.3 (INVESTOR chair close-up); hq leads with chair rows; podcast banner moves into the tour tail.
import { readFile } from 'node:fs/promises';

const API = 'https://vibes-holding-app-production.up.railway.app';
const ENV_FILE = 'C:/Projects/vibes-club-app/server/.env.admin.local';

async function env() {
  const text = await readFile(ENV_FILE, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z_]+)\s*=\s*(.+)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].trim();
  }
  if (!out.ADMIN_LOGIN || !out.ADMIN_PASSWORD) throw new Error('ADMIN_LOGIN / ADMIN_PASSWORD missing');
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
console.log('logged in:', session.account?.name ?? 'ok');

const slots = await call('/api/admin/content/images', {}, token);
const url = new Map((slots.slots ?? slots).map((slot) => [slot.key, slot.url]));
for (const key of ['hq.1', 'hq.2', 'hq.3', 'hq.4', 'home.banner']) {
  if (!url.get(key)) throw new Error(`slot ${key} is empty — plan assumed it was filled`);
}

// old: hq.1=auditorium wide, hq.2=chair rows, hq.3=chair close-up, hq.4=handshake, home.banner=podcast banner
const moves = [
  { key: 'home.banner', to: url.get('hq.3') }, // INVESTOR chair close-up leads the app
  { key: 'hq.1', to: url.get('hq.2') }, // chair rows open the tour
  { key: 'hq.2', to: url.get('hq.1') }, // auditorium wide second
  { key: 'hq.3', to: url.get('hq.4') }, // handshake between the chairs
  { key: 'hq.4', to: url.get('home.banner') }, // the podcast banner joins the tour tail
];
for (const move of moves) {
  await call('/api/admin/content/image', { method: 'PUT', body: JSON.stringify({ key: move.key, url: move.to }) }, token);
  console.log(`OK ${move.key}`);
}

const after = await call('/api/admin/content/images', {}, token);
for (const slot of after.slots ?? after) {
  if (['home.banner', 'hq.1', 'hq.2', 'hq.3', 'hq.4', 'hq.5', 'hq.6'].includes(slot.key)) console.log(slot.key, '->', (slot.url ?? '').slice(-40));
}
console.log('DONE');
