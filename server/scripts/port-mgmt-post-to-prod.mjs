// Ports the «رسائل الإدارة» management post from the TEST server to PROD — text from the two txt
// files, and (since 2026-10-31, owner: the images must never drop again) the media and the pin
// from the TEST post itself: every image is downloaded from TEST and re-uploaded to PROD's own
// storage, the YouTube video and `pinned` are copied as they are.
// Needs a PROD dashboard session: `node server/scripts/admin-session.mjs dashboard prod` then
// `... dashboard prod <mailed code>` (see admin-session.mjs). Then: node server/scripts/port-mgmt-post-to-prod.mjs
import { readFile } from 'node:fs/promises';

import { adminCall, API, API_PROD } from './admin-session.mjs';

const TITLE_AR = 'لماذا لم نحضر الملتقيات والمعارض خلال فترة التأسيس';
const TITLE_EN = 'Why we skipped the big meetups and exhibitions during our founding phase';

const bodyAr = (await readFile(new URL('./mgmt-post-ar.txt', import.meta.url), 'utf8')).trim();
const bodyEn = (await readFile(new URL('./mgmt-post-en.txt', import.meta.url), 'utf8')).trim();

// The source of truth for media and pin: the TEST member feed (a member session is enough there).
const test = await adminCall('/api/posts?limit=10', {}, API);
const source = test.posts.find((entry) => entry.title.trim() === TITLE_AR);
if (!source) throw new Error('the post is not in the TEST feed');
console.log('TEST post:', source.id, 'images', source.images.length, 'youtube', source.youtubeId ?? '-', 'pinned', source.pinned);

/** Copies one image: TEST media URL -> bytes -> PROD upload ticket -> PROD public URL. */
async function copyImage(url) {
  const got = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!got.ok) throw new Error(`download ${url} -> ${got.status}`);
  const contentType = (got.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
  const bytes = Buffer.from(await got.arrayBuffer());
  const filename = url.split('/').pop().split('?')[0] || 'image.jpg';
  const ticket = await adminCall('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ filename, contentType, size: bytes.length }) }, API_PROD);
  const { url: publicUrl, upload } = ticket;
  if (upload.method === 'PUT') {
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
    if (!put.ok) throw new Error(`PUT upload -> ${put.status}`);
  } else {
    const form = new FormData();
    for (const [name, value] of Object.entries(upload.fields ?? {})) form.append(name, value);
    form.append('file', new Blob([bytes], { type: contentType }), filename);
    const post = await fetch(upload.url, { method: 'POST', body: form });
    if (!post.ok) throw new Error(`POST upload -> ${post.status}`);
  }
  console.log('image copied:', bytes.length, 'bytes ->', publicUrl);
  return publicUrl;
}

// Idempotent: a second run updates the prod copy instead of duplicating it (edits never re-notify).
const { posts } = await adminCall('/api/admin/posts', {}, API_PROD);
const existing = posts.find((entry) => entry.title.trim() === TITLE_AR);

// Images already on PROD's own storage stay; only the ones PROD lacks are copied (by file name).
const prodImages = existing?.images ?? [];
const nameOf = (url) => url.split('/').pop().split('?')[0];
const images = [];
for (const url of source.images) {
  const have = prodImages.find((entry) => nameOf(entry) === nameOf(url));
  images.push(have ?? (await copyImage(url)));
}

const input = {
  title: TITLE_AR,
  body: bodyAr,
  links: source.links ?? [],
  images,
  video: source.youtubeId ? `https://www.youtube.com/watch?v=${source.youtubeId}` : null,
  videoFile: source.video ?? null,
  status: 'published',
  pinned: Boolean(source.pinned),
  kind: 'post',
  event: null,
  poll: null,
  audience: { type: 'all' },
  english: { title: TITLE_EN, body: bodyEn },
};

const { post: saved } = existing
  ? await adminCall(`/api/admin/posts/${existing.id}`, { method: 'PUT', body: JSON.stringify(input) }, API_PROD)
  : await adminCall('/api/admin/posts', { method: 'POST', body: JSON.stringify(input) }, API_PROD);

console.log(existing ? 'updated existing prod post:' : 'created on prod:', saved.id);
console.log('images:', saved.images.length, 'youtube:', saved.youtubeId ?? '-', 'pinned:', saved.pinned);
console.log('english:', saved.en ? `${saved.en.body.length} chars (manual)` : 'MISSING');
console.log('status:', saved.status, existing ? '— edit, no new push' : '— FIRST publish: the push to all prod devices went out');
