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
  // شركاء النجاح — the Arabic-signage meeting leads, the factory expansion closes.
  { file: 'success-partners-5.webp', slot: 'service.success-partners' },
  { file: 'success-partners-3.webp', slot: 'service.success-partners.2' },
  { file: 'success-partners-2.webp', slot: 'service.success-partners.3' },
  { file: 'success-partners-1.webp', slot: 'service.success-partners.4' },
  { file: 'success-partners-4.webp', slot: 'service.success-partners.5' },
  { file: 'success-partners-6.webp', slot: 'service.success-partners.6' },
  // تصميم Pitch Deck — real sample slides; the polished Arabic product slide leads.
  { file: 'pitch-deck-4.webp', slot: 'service.pitch-deck' },
  { file: 'pitch-deck-1.webp', slot: 'service.pitch-deck.2' },
  { file: 'pitch-deck-2.webp', slot: 'service.pitch-deck.3' },
  { file: 'pitch-deck-5.webp', slot: 'service.pitch-deck.4' },
  { file: 'pitch-deck-3.webp', slot: 'service.pitch-deck.5' },
  { file: 'pitch-deck-6.webp', slot: 'service.pitch-deck.6' },
  // ورش العمل — REAL workshop photos; the wide session shot leads.
  { file: 'workshop-5.webp', slot: 'service.workshop' },
  { file: 'workshop-2.webp', slot: 'service.workshop.2' },
  { file: 'workshop-3.webp', slot: 'service.workshop.3' },
  { file: 'workshop-4.webp', slot: 'service.workshop.4' },
  { file: 'workshop-6.webp', slot: 'service.workshop.5' },
  { file: 'workshop-1.webp', slot: 'service.workshop.6' },
  // زيارة مقر النادي — REAL HQ photos: the blue-lit theatre leads, a live audience shows the club alive.
  { file: 'hq-visit-1.jpg', slot: 'service.hq-visit' },
  { file: 'hq-visit-2.jpg', slot: 'service.hq-visit.2' },
  { file: 'hq-visit-3.jpg', slot: 'service.hq-visit.3' },
  { file: 'hq-visit-4.jpg', slot: 'service.hq-visit.4' },
  { file: 'hq-visit-5.jpg', slot: 'service.hq-visit.5' },
  { file: 'hq-visit-6.jpg', slot: 'service.hq-visit.6' },
  // مسرح النادي وقاعة الاجتماعات — the wide stage view leads; the meeting room closes.
  { file: 'theater-1.jpg', slot: 'service.theater' },
  { file: 'theater-2.jpg', slot: 'service.theater.2' },
  { file: 'theater-3.jpg', slot: 'service.theater.3' },
  { file: 'theater-4.jpg', slot: 'service.theater.4' },
  { file: 'theater-5.jpg', slot: 'service.theater.5' },
  { file: 'theater-6.jpg', slot: 'service.theater.6' },
  // استشارة أونلاين مع مستشار ذكي — the luxurious gold-marble shot leads (and the voice UI fits M104).
  { file: 'consultation-1.webp', slot: 'service.consultation' },
  { file: 'consultation-2.webp', slot: 'service.consultation.2' },
  { file: 'consultation-3.webp', slot: 'service.consultation.3' },
  { file: 'consultation-4.webp', slot: 'service.consultation.4' },
  { file: 'consultation-5.webp', slot: 'service.consultation.5' },
  { file: 'consultation-6.webp', slot: 'service.consultation.6' },
  // شخصية ومسيرة — member portraits (4 photos; the rest of the slots stay empty).
  { file: 'famous-1.jpg', slot: 'service.famous' },
  { file: 'famous-2.jpg', slot: 'service.famous.2' },
  { file: 'famous-3.jpg', slot: 'service.famous.3' },
  { file: 'famous-4.jpg', slot: 'service.famous.4' },
  // إبراز مشروعك على منصات النادي — the audience sees your project; the interview closes.
  { file: 'repost-1.jpg', slot: 'service.repost' },
  { file: 'repost-2.jpg', slot: 'service.repost.2' },
  { file: 'repost-3.jpg', slot: 'service.repost.3' },
  { file: 'repost-4.jpg', slot: 'service.repost.4' },
  { file: 'repost-5.jpg', slot: 'service.repost.5' },
  // رصيد بنك المشاريع — the bank itself: 260 projects headline first, then the project cards.
  { file: 'credit-1.webp', slot: 'service.credit' },
  { file: 'credit-2.webp', slot: 'service.credit.2' },
  { file: 'credit-3.webp', slot: 'service.credit.3' },
  { file: 'credit-4.webp', slot: 'service.credit.4' },
  // مومنتوم — the glowing MOMENTUM mark leads, then the agency's campaign creatives.
  { file: 'momentum-1.webp', slot: 'service.momentum' },
  { file: 'momentum-2.webp', slot: 'service.momentum.2' },
  { file: 'momentum-3.webp', slot: 'service.momentum.3' },
  { file: 'momentum-4.webp', slot: 'service.momentum.4' },
  { file: 'momentum-5.webp', slot: 'service.momentum.5' },
  // حقيبة الامتياز — the golden «تمكين الامتياز» banner leads, then the franchise stories.
  { file: 'franchise-1.webp', slot: 'service.franchise' },
  { file: 'franchise-2.webp', slot: 'service.franchise.2' },
  { file: 'franchise-3.webp', slot: 'service.franchise.3' },
  { file: 'franchise-4.webp', slot: 'service.franchise.4' },
  { file: 'franchise-5.webp', slot: 'service.franchise.5' },
  { file: 'franchise-6.webp', slot: 'service.franchise.6' },
  // كود خصم منتجات «منفذ» — the products-and-Riyadh display leads, the invoice closes.
  { file: 'manfath-1.webp', slot: 'service.manfaz' },
  { file: 'manfath-2.webp', slot: 'service.manfaz.2' },
  { file: 'manfath-3.webp', slot: 'service.manfaz.3' },
  { file: 'manfath-4.webp', slot: 'service.manfaz.4' },
  { file: 'manfath-5.webp', slot: 'service.manfaz.5' },
  { file: 'manfath-6.webp', slot: 'service.manfaz.6' },
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
  const mime = file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'image/webp';
  const ticketResponse = await call('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ filename: basename(file), contentType: mime, size: bytes.length }) }, token);
  const { url: publicUrl, upload } = ticketResponse;
  if (upload.method === 'PUT') {
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
    if (!put.ok) throw new Error(`PUT upload for ${step.slot} -> ${put.status}`);
  } else {
    const form = new FormData();
    for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
    form.append('file', new Blob([bytes], { type: mime }), basename(file));
    const post = await fetch(upload.url, { method: 'POST', body: form });
    if (!post.ok) throw new Error(`POST upload for ${step.slot} -> ${post.status}`);
  }
  await call('/api/admin/content/image', { method: 'PUT', body: JSON.stringify({ key: step.slot, url: publicUrl }) }, token);
  console.log(`OK ${step.slot} <- ${step.file}`);
}

console.log('DONE');
