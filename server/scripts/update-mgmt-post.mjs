// M122 ride-along (owner, 2026-10-23): restructure the long «رسالة الإدارة» post (no more wall of
// text) and give it a hand-written English translation. The texts live beside this script
// (mgmt-post-ar.txt / mgmt-post-en.txt); run it once against the TEST server:
//   node server/scripts/update-mgmt-post.mjs
// Credentials come ONLY from server/.env.admin.local (git-ignored); nothing secret is printed.
import { readFile } from 'node:fs/promises';

const API = 'https://vibes-holding-app-production.up.railway.app';
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

const { posts } = await call('/api/admin/posts', {}, token);
const post = posts.find((entry) => entry.title.trim() === TITLE_AR);
if (!post) throw new Error(`post «${TITLE_AR}» not found (${posts.length} posts listed)`);

const bodyAr = (await readFile(new URL('./mgmt-post-ar.txt', import.meta.url), 'utf8')).trim();
const bodyEn = (await readFile(new URL('./mgmt-post-en.txt', import.meta.url), 'utf8')).trim();

const input = {
  title: post.title,
  body: bodyAr,
  links: post.links ?? [],
  images: post.images ?? [],
  video: post.youtubeId ?? null,
  videoFile: post.video ?? null,
  status: post.status,
  pinned: Boolean(post.pinned),
  kind: post.kind ?? 'post',
  event: post.event ?? null,
  poll: null,
  audience: post.audience ?? { type: 'all' },
  english: { title: TITLE_EN, body: bodyEn },
};
const { post: saved } = await call(`/api/admin/posts/${post.id}`, { method: 'PUT', body: JSON.stringify(input) }, token);
console.log('updated:', saved.id);
console.log('arabic:', saved.body.split('\n').length, 'lines,', saved.body.length, 'chars');
console.log('english:', saved.en ? `${saved.en.body.length} chars (manual)` : 'MISSING');
console.log('status:', saved.status, '— edits never re-notify, no push went out');
