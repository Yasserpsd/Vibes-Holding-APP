// M121b: re-pull every golden offer page on both servers so the brand normalization
// (فايبز القابضة → Vibes Ventures, parse.ts) replaces the stored blocks, then verify.
//   node server/scripts/refresh-golden-offers.mjs
// Credentials come ONLY from server/.env.admin.local (git-ignored); nothing secret is printed.
import { readFile } from 'node:fs/promises';

const SERVERS = {
  test: 'https://vibes-holding-app-production.up.railway.app',
  prod: 'https://club-api-prod-production.up.railway.app',
};
const ENV_FILE = new URL('../.env.admin.local', import.meta.url);

async function env() {
  const text = await readFile(ENV_FILE, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z_]+)\s*=\s*(.+)$/.exec(line.trim().replace(/^﻿/, ''));
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
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(body?.error ?? body ?? '')}`);
  return body;
}

const creds = await env();
for (const [name, base] of Object.entries(SERVERS)) {
  const session = await call(base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ login: creds.ADMIN_LOGIN, password: creds.ADMIN_PASSWORD }) });
  if (!session.token) throw new Error(`${name}: no token in the login response`);
  const refreshed = await call(base, '/api/admin/golden/refresh', { method: 'POST', body: '{}' }, session.token);
  const offer = await call(base, '/api/golden/offer/V', {}, session.token);
  const text = JSON.stringify(offer.blocks ?? []);
  const oldName = (text.match(/[ڤف]ايبز|فيبس\s+فينشرز/g) ?? []).length;
  const newName = (text.match(/Vibes Ventures/g) ?? []).length;
  console.log(name, JSON.stringify({ refreshed: refreshed.ok ?? false, blocks: (offer.blocks ?? []).length, oldBrandHits: oldName, vibesVenturesHits: newName }));
}
console.log('done');
