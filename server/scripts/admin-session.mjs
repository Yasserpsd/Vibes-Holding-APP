// Shared admin session for probe scripts (owner, 2026-10-25: sign in ONCE, reuse the token).
// The token lives in server/.env.admin.session.local (git-ignored via .env.*); a 401 refreshes it.
import { createHmac } from 'node:crypto';
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
  let { response, body } = await raw('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: c.ADMIN_LOGIN, password: c.ADMIN_PASSWORD }) }, undefined, api);
  // M140: the account has an authenticator app — answer its step from ADMIN_TOTP_SECRET (the base32 key shown at enrolment).
  if (response.ok && body?.totp) {
    if (!c.ADMIN_TOTP_SECRET) throw new Error('the account asks for an authenticator code: add ADMIN_TOTP_SECRET to .env.admin.local');
    ({ response, body } = await raw('/api/auth/totp', { method: 'POST', body: JSON.stringify({ stepToken: body.stepToken, code: totpCode(c.ADMIN_TOTP_SECRET) }) }, undefined, api));
  }
  if (!response.ok || !body?.token) throw new Error(`login failed: ${response.status}`);
  await writeFile(tokenFile(api), `${body.token}\n`, 'utf8');
  return body.token;
}

/** RFC 6238, the same arithmetic as server/src/auth/totp.ts (30-second steps, 6 digits, SHA-1). */
function totpCode(secret, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const char of secret.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
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
