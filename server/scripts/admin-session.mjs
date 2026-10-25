// Shared admin session for probe scripts (owner, 2026-10-25: sign in ONCE, reuse the token).
// The token lives in server/.env.admin.session.local (git-ignored via .env.*); a 401 refreshes it.
import { readFile, writeFile } from 'node:fs/promises';

const API = 'https://vibes-holding-app-production.up.railway.app';
const ENV_FILE = new URL('../.env.admin.local', import.meta.url);
const TOKEN_FILE = new URL('../.env.admin.session.local', import.meta.url);

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

async function raw(path, options = {}, token) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(25000),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function login() {
  const c = await creds();
  const { response, body } = await raw('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: c.ADMIN_LOGIN, password: c.ADMIN_PASSWORD }) });
  if (!response.ok || !body?.token) throw new Error(`login failed: ${response.status}`);
  await writeFile(TOKEN_FILE, `${body.token}\n`, 'utf8');
  return body.token;
}

async function savedToken() {
  try { return (await readFile(TOKEN_FILE, 'utf8')).trim() || null; } catch { return null; }
}

/** GET/POST against the live server with the cached admin session; re-logs in once on a 401. */
export async function adminCall(path, options = {}) {
  let token = (await savedToken()) ?? (await login());
  let { response, body } = await raw(path, options, token);
  if (response.status === 401) {
    token = await login();
    ({ response, body } = await raw(path, options, token));
  }
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(body?.error ?? '')}`);
  return body;
}

export { API };
