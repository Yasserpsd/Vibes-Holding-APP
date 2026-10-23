// M114 iOS review: activate a 365-day membership on the Apple review demo account
// (contact 340, development+appledemo@vibesholding.com) on the PRODUCTION server.
// Run once:  node C:\Projects\vibes-club-app\server\scripts\activate-demo-membership.mjs
// Credentials come ONLY from server/.env.admin.local (git-ignored); nothing secret is printed.
import { readFile } from 'node:fs/promises';

const API = 'https://club-api-prod-production.up.railway.app';
const CONTACT_ID = 340;
const ENV_FILE = new URL('../.env.admin.local', import.meta.url);

async function env() {
  const text = await readFile(ENV_FILE, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z_]+)\s*=\s*(.+)$/.exec(line.trim().replace(/^\uFEFF/, ''));
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
if (!session.token) throw new Error('no token in the login response');

const result = await call(
  `/api/admin/accounts/${CONTACT_ID}/grant`,
  { method: 'POST', body: JSON.stringify({ action: 'activate', days: 365, note: 'App Review demo account (Apple reviewers)', confirm: true }) },
  session.token,
);
console.log('membership:', JSON.stringify(result?.account?.membership ?? result).slice(0, 200));
console.log('done — the demo account is an active member for 365 days');
