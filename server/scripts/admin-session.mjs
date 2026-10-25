// Shared admin session for probe scripts (owner, 2026-10-25: sign in ONCE, reuse the token).
// The token lives in server/.env.admin.session.local (git-ignored via .env.*); a 401 refreshes it.
import { readFile, writeFile } from 'node:fs/promises';

const API = 'https://vibes-holding-app-production.up.railway.app';
/** The production server (same hub account signs in on both). */
const API_PROD = 'https://club-api-prod-production.up.railway.app';
const ENV_FILE = new URL('../.env.admin.local', import.meta.url);
const tokenFile = (api) => new URL(api === API_PROD ? '../.env.admin.session.prod.local' : '../.env.admin.session.local', import.meta.url);

async function creds() {
  const text = await readFile(ENV_FILE, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z_]+)\s*=\s*(.+)$/.exec(line.trim().replace(/^﻿/, ''));
    if (m) out[m[1]] = m[2].trim();
  }
  if (!out.ADMIN_LOGIN || !out.ADMIN_PASSWORD) throw new Error('ADMIN_LOGIN / ADMIN_PASSWORD missing in .env.admin.local');
  return out;
}

async function raw(path, options = {}, token, api = API) {
  const response = await fetch(`${api}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(25000),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function login(api = API) {
  const c = await creds();
  const { response, body } = await raw('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: c.ADMIN_LOGIN, password: c.ADMIN_PASSWORD }) }, undefined, api);
  if (!response.ok || !body?.token) throw new Error(`login failed: ${response.status}`);
  await writeFile(tokenFile(api), `${body.token}\n`, 'utf8');
  return body.token;
}

async function savedToken(api = API) {
  try { return (await readFile(tokenFile(api), 'utf8')).trim() || null; } catch { return null; }
}

/** GET/POST against a live server (TEST by default, pass API_PROD for prod) with the cached admin session; re-logs in once on a 401. */
export async function adminCall(path, options = {}, api = API) {
  let token = (await savedToken(api)) ?? (await login(api));
  let { response, body } = await raw(path, options, token, api);
  if (response.status === 401) {
    token = await login(api);
    ({ response, body } = await raw(path, options, token, api));
  }
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(body?.error ?? '')}`);
  return body;
}

export { API, API_PROD };
