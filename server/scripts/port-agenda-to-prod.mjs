// M120-style port: copy the agenda EVENT DEFINITIONS from the TEST server to PROD
// (titles, blurbs, dates, places, fees, interests, hero image, M43 English) — never
// registrations, tickets or passes. Hero images are re-uploaded to prod's own bucket
// so prod never references test /media/ URLs.
// Credentials come ONLY from server/.env.admin.local (git-ignored); nothing secret is printed.
// Usage: node server/scripts/port-agenda-to-prod.mjs [--dry-run]
import { readFile } from 'node:fs/promises';

const TEST = 'https://vibes-holding-app-production.up.railway.app';
const PROD = 'https://club-api-prod-production.up.railway.app';
const ENV_FILE = 'C:/Projects/vibes-club-app/server/.env.admin.local';
const DRY = process.argv.includes('--dry-run');

async function env() {
  const text = await readFile(ENV_FILE, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\uFEFF?([A-Z_]+)\s*=\s*(.+)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].trim();
  }
  if (!out.ADMIN_LOGIN || !out.ADMIN_PASSWORD) throw new Error('ADMIN_LOGIN / ADMIN_PASSWORD missing in .env.admin.local');
  return out;
}

async function call(base, path, options = {}, token) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${base}${path} -> ${response.status} ${JSON.stringify(body?.error ?? body ?? '')}`);
  return body;
}

async function login(base, creds) {
  const session = await call(base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ login: creds.ADMIN_LOGIN, password: creds.ADMIN_PASSWORD }) });
  if (session.pending) throw new Error(`login on ${base} answered pending (mail code) — tell Claude`);
  if (!session.token) throw new Error(`no token in the login response from ${base}`);
  return session.token;
}

const creds = await env();
const testToken = await login(TEST, creds);
console.log('logged in to TEST');
const { events } = await call(TEST, '/api/admin/agenda', {}, testToken);
console.log(`TEST agenda events: ${events.length}`);

const prodToken = DRY ? null : await login(PROD, creds);
if (!DRY) console.log('logged in to PROD');
const prodExisting = DRY ? [] : (await call(PROD, '/api/admin/agenda', {}, prodToken)).events;

for (const event of events) {
  const label = `«${event.title}» ${event.date}`;
  if (!DRY && prodExisting.some((p) => p.title === event.title && p.date === event.date)) {
    console.log(`SKIP ${label}: already on prod`);
    continue;
  }

  // 1) Re-upload the hero image to prod's own bucket.
  let imageUrl = null;
  if (event.imageUrl) {
    if (DRY) {
      console.log(`DRY ${label}: would download ${event.imageUrl} and re-upload to prod`);
      imageUrl = '(new prod url)';
    } else {
      const image = await fetch(event.imageUrl);
      if (!image.ok) throw new Error(`hero image download -> ${image.status}`);
      const bytes = Buffer.from(await image.arrayBuffer());
      const contentType = image.headers.get('content-type') || 'image/webp';
      const filename = event.imageUrl.split('/').pop() || 'hero.webp';
      const ticket = await call(PROD, '/api/admin/uploads', { method: 'POST', body: JSON.stringify({ filename, contentType, size: bytes.length }) }, prodToken);
      const { url: publicUrl, upload } = ticket;
      if (upload.method === 'PUT') {
        const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
        if (!put.ok) throw new Error(`PUT upload -> ${put.status}`);
      } else {
        const form = new FormData();
        for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
        form.append('file', new Blob([bytes], { type: contentType }), filename);
        const post = await fetch(upload.url, { method: 'POST', body: form });
        if (!post.ok) throw new Error(`POST upload -> ${post.status}`);
      }
      imageUrl = publicUrl;
      console.log(`image for ${label}: re-uploaded (${bytes.length} bytes)`);
    }
  }

  // 2) Create the event CLOSED first so autoPush never announces it, then reopen via PUT (no push there).
  const payload = {
    title: event.title,
    blurb: event.blurb ?? '',
    date: event.date,
    ...(event.dates?.length ? { dates: event.dates } : {}),
    time: event.time ?? '',
    endTime: event.endTime ?? '',
    place: event.place ?? '',
    onlineUrl: event.onlineUrl ?? '',
    ...(imageUrl && !DRY ? { imageUrl } : {}),
    mode: event.mode,
    feeSar: event.feeSar ?? 0,
    memberFeeSar: event.memberFeeSar ?? 0,
    interests: event.interests ?? [],
    open: false,
    ...(event.en ? { english: { title: event.en.title ?? '', blurb: event.en.blurb ?? '', place: event.en.place ?? '' } } : {}),
  };
  if (DRY) {
    console.log(`DRY ${label}: would create then set open=${event.open}`);
    console.log(JSON.stringify({ ...payload, blurb: `(${payload.blurb.length} chars)`, english: event.en ? '(ported)' : undefined }));
    continue;
  }
  const created = await call(PROD, '/api/admin/agenda', { method: 'POST', body: JSON.stringify(payload) }, prodToken);
  const id = created.event.id;
  if (event.open) await call(PROD, `/api/admin/agenda/${id}`, { method: 'PUT', body: JSON.stringify({ open: true }) }, prodToken);
  console.log(`OK ${label} -> prod ${id}`);
}

if (!DRY) {
  const after = await call(PROD, '/api/agenda', {});
  console.log(`prod /api/agenda now lists ${after.events.length} event(s)`);
  for (const e of after.events) {
    let image = 'no image';
    if (e.imageUrl) {
      const head = await fetch(e.imageUrl, { method: 'HEAD' });
      image = `image ${head.status}`;
    }
    console.log(`- «${e.title}» ${e.date} open=${e.open} ${image}`);
  }
}
console.log(DRY ? 'DRY RUN DONE (nothing written)' : 'DONE');
