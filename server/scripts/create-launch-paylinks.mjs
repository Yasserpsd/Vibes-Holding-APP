// M108: create the launch payment links (one per package from vibes-services.pdf) on the LIVE server.
// Credentials come ONLY from server/.env.admin.local (git-ignored); nothing secret is printed.
import { readFile } from 'node:fs/promises';

const API = 'https://vibes-holding-app-production.up.railway.app';
const ENV_FILE = 'C:/Projects/vibes-club-app/server/.env.admin.local';

// M108b: permanent links — a stable /pay/link/:id URL that mints a fresh invoice per visitor, forever.
const LINKS = [
  { kind: 'membership', amountSar: 3900, permanent: true, label: 'العضوية السنوية لنادي المستثمرين — السعر الكامل' },
  { kind: 'membership', amountSar: 1900, permanent: true, label: 'العضوية السنوية لنادي المستثمرين — سعر العرض' },
  { kind: 'other', amountSar: 15000, permanent: true, label: 'خدمة اصنع ملتقاك — الباقة الأساسية' },
  { kind: 'other', amountSar: 30000, permanent: true, label: 'خدمة اصنع ملتقاك — الباقة الكاملة' },
  { kind: 'other', amountSar: 2500, permanent: true, label: 'خدمة Pitch Deck — الباقة الأساسية' },
  { kind: 'other', amountSar: 5000, permanent: true, label: 'خدمة Pitch Deck — الباقة الكاملة' },
  { kind: 'workshop', amountSar: 290, permanent: true, label: 'ورش العمل الدورية — ورشة أونلاين' },
  { kind: 'workshop', amountSar: 3000, permanent: true, label: 'ورش العمل الدورية — الورشة المتقدمة' },
];

const text = await readFile(ENV_FILE, 'utf8');
const env = {};
for (const line of text.split(/\r?\n/)) {
  const match = /^([A-Z_]+)\s*=\s*(.+)$/.exec(line.trim());
  if (match) env[match[1]] = match[2].trim();
}
if (!env.ADMIN_LOGIN || !env.ADMIN_PASSWORD) throw new Error('ADMIN_LOGIN / ADMIN_PASSWORD missing');

async function call(path, options = {}, token) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(body?.error ?? body ?? '')}`);
  return body;
}

const session = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: env.ADMIN_LOGIN, password: env.ADMIN_PASSWORD }) });
if (!session.token) throw new Error('no token in the login response');
console.log('logged in as admin');

const out = [];
for (const link of LINKS) {
  const created = await call('/api/admin/paylinks', { method: 'POST', body: JSON.stringify({ ...link, days: 365 }) }, session.token);
  const row = created.link;
  out.push({ label: link.label, amountSar: link.amountSar, url: row.checkoutUrl, paymentId: row.paymentId, activation: row.activation, note: row.activationNote });
  console.log('created:', link.amountSar, 'SAR —', link.label);
}

console.log('\nRESULT_JSON');
console.log(JSON.stringify(out, null, 1));
