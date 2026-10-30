// Creates (or updates, by exact title) one «أجندة النادي» event on a live server from a JSON file,
// with an optional hero image uploaded to that server's own storage. The event is created CLOSED
// and reopened with a PUT so the automatic «new event» push never goes out by accident: the owner
// presses «إشعار» in the dashboard when he wants it.
// Usage: node server/scripts/create-agenda-event.mjs <event.json> [--hero <wide image>] [--cover <square image>] [prod]
// (prod needs the dashboard session: node server/scripts/admin-session.mjs dashboard prod ...)
// M167: two pictures per event — the wide hero inside the event page (`imageUrl`) and the square
// cover on the cards outside it (`coverUrl`); both editable from the dashboard afterwards.
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { adminCall, API, API_PROD } from './admin-session.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : null;
};
const jsonPath = args.find((arg, index) => !arg.startsWith('--') && arg !== 'prod' && args[index - 1] !== '--hero' && args[index - 1] !== '--cover');
if (!jsonPath) throw new Error('usage: create-agenda-event.mjs <event.json> [--hero <wide image>] [--cover <square image>] [prod]');
const api = args.includes('prod') ? API_PROD : API;
const heroPath = flag('--hero');
const coverPath = flag('--cover');
const event = JSON.parse(await readFile(jsonPath, 'utf8'));

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function uploadHero(file) {
  const bytes = await readFile(file);
  const contentType = MIME[extname(file).toLowerCase()] ?? 'image/jpeg';
  const filename = basename(file);
  const { url: publicUrl, upload } = await adminCall('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ filename, contentType, size: bytes.length }) }, api);
  if (upload.method === 'PUT') {
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
    if (!put.ok) throw new Error(`PUT upload -> ${put.status}`);
  } else {
    const form = new FormData();
    for (const [name, value] of Object.entries(upload.fields ?? {})) form.append(name, value);
    form.append('file', new Blob([bytes], { type: contentType }), filename);
    const post = await fetch(upload.url, { method: 'POST', body: form });
    if (!post.ok) throw new Error(`POST upload -> ${post.status}`);
  }
  console.log('hero uploaded:', bytes.length, 'bytes ->', publicUrl);
  return publicUrl;
}

const { events } = await adminCall('/api/admin/agenda', {}, api);
const existing = events.find((entry) => entry.title.trim() === event.title.trim());
const imageUrl = heroPath ? await uploadHero(heroPath) : (existing?.imageUrl ?? null);
const coverUrl = coverPath ? await uploadHero(coverPath) : (existing?.coverUrl ?? null);
const open = event.open !== false;
const payload = { ...event, ...(imageUrl ? { imageUrl } : {}), ...(coverUrl ? { coverUrl } : {}), open: false };

let id;
if (existing) {
  id = existing.id;
  await adminCall(`/api/admin/agenda/${id}`, { method: 'PUT', body: JSON.stringify({ ...payload, open }) }, api);
  console.log('updated existing event:', id);
} else {
  const created = await adminCall('/api/admin/agenda', { method: 'POST', body: JSON.stringify(payload) }, api);
  id = created.event.id;
  if (open) await adminCall(`/api/admin/agenda/${id}`, { method: 'PUT', body: JSON.stringify({ open: true }) }, api);
  console.log('created event (no push):', id);
}
const { event: saved } = await adminCall(`/api/admin/agenda/${id}`, {}, api).catch(() => ({ event: null }));
const check = saved ?? (await adminCall('/api/agenda', {}, api)).events.find((entry) => entry.id === id);
console.log(JSON.stringify({ title: check.title, date: check.date, dates: check.dates, time: check.time, endTime: check.endTime, mode: check.mode, feeSar: check.feeSar, memberFeeSar: check.memberFeeSar, open: check.open, hero: Boolean(check.imageUrl), cover: Boolean(check.coverUrl) }));
