// M123 ride-along (owner approved 2026-10-24): «رسائل الإدارة» looks empty on PROD because the
// restructured management post lives on the TEST server only. This script creates the same post on
// PROD from the canonical texts beside it (mgmt-post-ar.txt / mgmt-post-en.txt). THE OWNER runs it:
//   node server/scripts/port-mgmt-post-to-prod.mjs
// NOTE: the first publish AUTO-PUSHES a notification to every prod device (M42) — run it when that
// is wanted. If the hub feed already carries the test copy, the sites may show it twice.
// Credentials come ONLY from server/.env.admin.local (git-ignored); nothing secret is printed.
import { readFile } from 'node:fs/promises';

const API = 'https://club-api-prod-production.up.railway.app';
const ENV_FILE = new URL('../.env.admin.local', import.meta.url);
const TITLE_AR = 'لماذا لم نحضر الملتقيات والمعارض خلال فترة التأسيس';
const TITLE_EN = 'Why we skipped the big meetups and exhibitions during our founding phase';

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
const token = session.token;

const bodyAr = (await readFile(new URL('./mgmt-post-ar.txt', import.meta.url), 'utf8')).trim();
const bodyEn = (await readFile(new URL('./mgmt-post-en.txt', import.meta.url), 'utf8')).trim();

const input = {
  title: TITLE_AR,
  body: bodyAr,
  links: [],
  images: [],
  video: null,
  videoFile: null,
  status: 'published',
  pinned: false,
  kind: 'post',
  event: null,
  poll: null,
  audience: { type: 'all' },
  english: { title: TITLE_EN, body: bodyEn },
};

// Idempotent: a second run updates the prod copy instead of duplicating it (edits never re-notify).
const { posts } = await call('/api/admin/posts', {}, token);
const existing = posts.find((entry) => entry.title.trim() === TITLE_AR);
const { post: saved } = existing
  ? await call(`/api/admin/posts/${existing.id}`, { method: 'PUT', body: JSON.stringify(input) }, token)
  : await call('/api/admin/posts', { method: 'POST', body: JSON.stringify(input) }, token);

console.log(existing ? 'updated existing prod post:' : 'created on prod:', saved.id);
console.log('arabic:', saved.body.split('\n').length, 'lines,', saved.body.length, 'chars');
console.log('english:', saved.en ? `${saved.en.body.length} chars (manual)` : 'MISSING');
console.log('status:', saved.status, existing ? '— edit, no new push' : '— FIRST publish: the push to all prod devices went out');
