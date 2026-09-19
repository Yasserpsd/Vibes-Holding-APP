import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { S3MediaStore } from './media/s3.js';
import { DiskMediaStore, UploadTooLargeError } from './media/store.js';
import { MemoryKV } from './store.js';
import { TemplateBlurbWriter } from './videos/blurbs.js';

// M15: uploads in the dashboard — tickets, the disk store, /media links, posts with uploaded media, clean-up.
const PUBLIC_URL = 'http://localhost:3000';
const KEY = /^posts\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|mp4)$/;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2000, 7)]);
const MP4 = Buffer.alloc(5000, 3);

let uploadsDir = '';
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers: { ...bearer(token), ...headers } });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

type Ticket = { key: string; url: string; kind: string; upload: { method: string; url: string; headers: Record<string, string> } };

async function ticketFor(contentType: string, size: number): Promise<Ticket> {
  const response = await send('POST', '/api/admin/uploads', { filename: 'file', contentType, size }, adminToken);
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as Ticket;
}

async function upload(contentType: string, body: Buffer): Promise<Ticket> {
  const ticket = await ticketFor(contentType, body.length);
  const path = ticket.upload.url.slice(PUBLIC_URL.length);
  const put = await app.inject({ method: 'PUT', url: path, headers: ticket.upload.headers, payload: body });
  assert.equal(put.statusCode, 204, put.body);
  return ticket;
}

const stored = async () => ((await readdir(uploadsDir, { recursive: true })) as string[]).filter((name) => /\.\w+$/.test(name)).length;
const post = (extra: Record<string, unknown>) => ({ title: 'منشور بملفات مرفوعة', body: 'نص', status: 'published', ...extra });

before(async () => {
  uploadsDir = await mkdtemp(join(tmpdir(), 'm15-uploads-'));
  const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', PUBLIC_URL, UPLOADS_DIR: uploadsDir, UPLOAD_MAX_IMAGE_MB: '1', UPLOAD_MAX_VIDEO_MB: '2' });
  built = await buildApp({ config, kv: new MemoryKV(), hub: new MockHubClient(), blurbs: new TemplateBlurbWriter(), mailer: new LogMailer() });
  app = built.app;
  const registered = await send('POST', '/api/auth/register', { name: 'مدير تجريبي', country: 'sa', phone: '0558318815', email: 'm15.admin@gmail.com', password: 'secret123', persona: 'investor', bio: 'حساب اختبار لرفع ملفات منشورات الإدارة.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  adminToken = verified.json().token as string;
});

after(async () => {
  await app.close();
  await rm(uploadsDir, { recursive: true, force: true });
});

test('upload endpoints are for admins and describe the limits', async () => {
  assert.equal((await get('/api/admin/uploads/config')).statusCode, 401);
  assert.equal((await send('POST', '/api/admin/uploads', { filename: 'a.png', contentType: 'image/png', size: 10 })).statusCode, 401);
  const config = (await get('/api/admin/uploads/config', adminToken)).json();
  assert.deepEqual(config.images, { types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxBytes: 1024 * 1024 });
  assert.deepEqual(config.videos, { types: ['video/mp4', 'video/quicktime', 'video/webm'], maxBytes: 2 * 1024 * 1024 });
  assert.equal(config.durable, false);
});

test('a ticket is refused for other types and for files over the limit', async () => {
  const svg = await send('POST', '/api/admin/uploads', { filename: 'x.svg', contentType: 'image/svg+xml', size: 10 }, adminToken);
  assert.equal(svg.statusCode, 400);
  assert.equal(svg.json().error.code, 'unsupported_type');
  const html = await send('POST', '/api/admin/uploads', { filename: 'x.html', contentType: 'text/html', size: 10 }, adminToken);
  assert.equal(html.json().error.code, 'unsupported_type');
  const big = await send('POST', '/api/admin/uploads', { filename: 'x.png', contentType: 'image/png', size: 1024 * 1024 + 1 }, adminToken);
  assert.equal(big.statusCode, 400);
  assert.equal(big.json().error.code, 'too_large');
  assert.match(big.json().error.message, /1 ميجابايت/);
  assert.equal((await send('POST', '/api/admin/uploads', { filename: 'x.png', contentType: 'image/png', size: 0 }, adminToken)).statusCode, 400);
});

test('the key comes from the server, never from the file name', async () => {
  const response = await send('POST', '/api/admin/uploads', { filename: '../../etc/passwd.png', contentType: 'IMAGE/PNG', size: 100 }, adminToken);
  assert.equal(response.statusCode, 201, response.body);
  const ticket = response.json() as Ticket;
  assert.match(ticket.key, KEY);
  assert.equal(ticket.kind, 'image');
  assert.equal(ticket.url, `${PUBLIC_URL}/media/${ticket.key}`);
  assert.equal(ticket.upload.method, 'PUT');
  assert.deepEqual(ticket.upload.headers, { 'content-type': 'image/png' });
});

test('a phone recording (QuickTime) is stored and served as MP4', async () => {
  const ticket = await ticketFor('video/quicktime', MP4.length);
  assert.match(ticket.key, /.mp4$/);
  assert.deepEqual(ticket.upload.headers, { 'content-type': 'video/mp4' });
});

test('a file over the 1 MB JSON limit streams through, a large JSON body does not', async () => {
  const large = Buffer.alloc(1024 * 1024 + 512 * 1024, 5);
  const ticket = await upload('video/mp4', large);
  assert.equal((await get(`/media/${ticket.key}`)).rawPayload.length, large.length);
  const path = ticket.upload.url.slice(PUBLIC_URL.length);
  const json = await app.inject({ method: 'PUT', url: path, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ filler: 'x'.repeat(1024 * 1024 + 10) }) });
  assert.equal(json.statusCode, 413);
});

test('the disk store accepts exactly what the ticket allows', async () => {
  const ticket = await ticketFor('image/png', PNG.length);
  const path = ticket.upload.url.slice(PUBLIC_URL.length);
  const wrongType = await app.inject({ method: 'PUT', url: path, headers: { 'content-type': 'image/jpeg' }, payload: PNG });
  assert.equal(wrongType.statusCode, 403);
  const forged = await app.inject({ method: 'PUT', url: `${path.slice(0, -3)}AAA`, headers: ticket.upload.headers, payload: PNG });
  assert.equal(forged.statusCode, 403);
  const tooBig = await app.inject({ method: 'PUT', url: path, headers: ticket.upload.headers, payload: Buffer.alloc(1024 * 1024 + 1) });
  assert.equal(tooBig.statusCode, 413);
  assert.equal((await get(`/media/${ticket.key}`)).statusCode, 404);
  const ok = await app.inject({ method: 'PUT', url: path, headers: ticket.upload.headers, payload: PNG });
  assert.equal(ok.statusCode, 204);
});

test('a body that grows past the limit while streaming is dropped', async () => {
  const store = new DiskMediaStore(uploadsDir, PUBLIC_URL);
  const key = 'posts/2026/01/00000000-0000-4000-8000-000000000000.png';
  const chunks = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
  await assert.rejects(store.write({ key, contentType: 'image/png', maxBytes: 1000, expires: Date.now() + 1000 }, chunks), UploadTooLargeError);
  assert.equal(await store.head(key), null);
  assert.equal((await readdir(join(uploadsDir, 'posts', '2026', '01'))).length, 0);
});

test('/media serves the file with ranges and refuses anything that is not a key', async () => {
  const ticket = await upload('video/mp4', MP4);
  const whole = await get(`/media/${ticket.key}`);
  assert.equal(whole.statusCode, 200);
  assert.equal(whole.headers['content-type'], 'video/mp4');
  assert.equal(whole.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(whole.headers['x-content-type-options'], 'nosniff');
  assert.equal(whole.rawPayload.length, MP4.length);
  const part = await get(`/media/${ticket.key}`, undefined, { range: 'bytes=100-199' });
  assert.equal(part.statusCode, 206);
  assert.equal(part.headers['content-range'], `bytes 100-199/${MP4.length}`);
  assert.equal(part.rawPayload.length, 100);
  const tail = await get(`/media/${ticket.key}`, undefined, { range: 'bytes=-50' });
  assert.equal(tail.headers['content-range'], `bytes ${MP4.length - 50}-${MP4.length - 1}/${MP4.length}`);
  assert.equal((await get(`/media/${ticket.key}`, undefined, { range: 'bytes=9000-' })).statusCode, 416);
  for (const path of ['/media/posts/2026/09/nope.png', '/media/..%2f..%2fpackage.json', '/media/%2e%2e/package.json', '/media/package.json']) {
    assert.equal((await get(path)).statusCode, 404, path);
  }
});

test('a post carries uploaded images and an uploaded video with its poster', async () => {
  const image = await upload('image/png', PNG);
  const poster = await upload('image/png', PNG);
  const video = await upload('video/mp4', MP4);
  const created = await send('POST', '/api/admin/posts', post({ images: [image.url, 'https://example.com/pasted.jpg'], videoFile: { url: video.url, poster: poster.url } }), adminToken);
  assert.equal(created.statusCode, 201, created.body);
  assert.deepEqual(created.json().post.video, { url: video.url, poster: poster.url });
  const publicPost = (await get(`/api/posts/${created.json().post.id}`)).json().post;
  assert.deepEqual(publicPost.video, { url: video.url, poster: poster.url });
  assert.deepEqual(publicPost.images, [image.url, 'https://example.com/pasted.jpg']);
  const plain = await send('POST', '/api/admin/posts', post({ title: 'بدون فيديو' }), adminToken);
  assert.equal((await get(`/api/posts/${plain.json().post.id}`)).json().post.video, null);
});

test('a post is refused when its uploaded media is missing or of the wrong kind', async () => {
  const image = await upload('image/png', PNG);
  const neverSent = await ticketFor('video/mp4', MP4.length);
  const cases: Record<string, unknown>[] = [
    { videoFile: { url: neverSent.url } },
    { videoFile: { url: image.url } },
    { videoFile: { url: 'https://example.com/movie.mp4' } },
    { images: [neverSent.url.replace('.mp4', '.png')] },
  ];
  for (const extra of cases) {
    const response = await send('POST', '/api/admin/posts', post(extra), adminToken);
    assert.equal(response.statusCode, 400, JSON.stringify(extra));
    assert.equal(response.json().error.code, 'invalid_media');
  }
  const video = await upload('video/mp4', MP4);
  const asImage = await send('POST', '/api/admin/posts', post({ videoFile: { url: video.url, poster: video.url } }), adminToken);
  assert.equal(asImage.json().error.code, 'invalid_media');
});

test('files a post stops using are removed, files another post still uses are kept', async () => {
  const shared = await upload('image/png', PNG);
  const own = await upload('image/png', PNG);
  const video = await upload('video/mp4', MP4);
  const first = (await send('POST', '/api/admin/posts', post({ images: [shared.url, own.url], videoFile: { url: video.url } }), adminToken)).json().post;
  const second = (await send('POST', '/api/admin/posts', post({ images: [shared.url] }), adminToken)).json().post;

  const updated = await send('PUT', `/api/admin/posts/${first.id}`, post({ images: [shared.url], videoFile: { url: video.url } }), adminToken);
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal((await get(`/media/${own.key}`)).statusCode, 404);
  assert.equal((await get(`/media/${video.key}`)).statusCode, 200);

  assert.equal((await send('DELETE', `/api/admin/posts/${first.id}`, undefined, adminToken)).statusCode, 200);
  assert.equal((await get(`/media/${video.key}`)).statusCode, 404);
  assert.equal((await get(`/media/${shared.key}`)).statusCode, 200);
  assert.equal((await send('DELETE', `/api/admin/posts/${second.id}`, undefined, adminToken)).statusCode, 200);
  assert.equal((await get(`/media/${shared.key}`)).statusCode, 404);
});

test('the sweep removes abandoned uploads after a day and nothing else', async () => {
  const used = await upload('image/png', PNG);
  const abandonedOld = await upload('image/png', PNG);
  const abandonedNew = await upload('image/png', PNG);
  await send('POST', '/api/admin/posts', post({ images: [used.url] }), adminToken);
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60_000);
  for (const ticket of [used, abandonedOld]) await utimes(join(uploadsDir, ticket.key), twoDaysAgo, twoDaysAgo);
  // Older tests left files behind: make every other file look fresh, so exactly one orphan is a day old.
  const count = await stored();
  assert.equal(await built.media.sweep(new Set([used.key, abandonedNew.key]), new Date(Date.now() - 47 * 60 * 60_000)), 0);
  const removed = await built.media.sweep(new Set([used.key]));
  assert.ok(removed >= 1, 'the old abandoned upload is removed');
  assert.equal((await get(`/media/${abandonedOld.key}`)).statusCode, 404);
  assert.equal((await get(`/media/${abandonedNew.key}`)).statusCode, 200);
  assert.equal((await get(`/media/${used.key}`)).statusCode, 200);
  assert.equal(await stored(), count - removed);
  assert.equal(built.media.status().swept !== null, true);
});

test('a bucket ticket pins the key, the type and the size; reads are presigned links (no network)', async () => {
  const store = new S3MediaStore({ bucket: 'club-media-abc123', endpoint: 'https://t3.storageapi.dev', region: 'auto', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-example-value', forcePathStyle: false, log: app.log });
  const key = 'posts/2026/09/11111111-1111-4111-8111-111111111111.mp4';
  const ticket = await store.ticket(key, 'video/mp4', 200 * 1024 * 1024);
  assert.equal(ticket.method, 'POST');
  if (ticket.method !== 'POST') return;
  assert.equal(new URL(ticket.url).host, 'club-media-abc123.t3.storageapi.dev');
  assert.equal(ticket.fields.key, key);
  assert.equal(ticket.fields['Content-Type'], 'video/mp4');
  assert.ok(ticket.fields['X-Amz-Signature']);
  const policy = JSON.parse(Buffer.from(ticket.fields.Policy ?? '', 'base64').toString('utf8')) as { conditions: unknown[] };
  assert.ok(policy.conditions.some((rule) => JSON.stringify(rule) === JSON.stringify(['content-length-range', 1, 200 * 1024 * 1024])));
  assert.ok(policy.conditions.some((rule) => JSON.stringify(rule) === JSON.stringify({ key })));
  assert.ok(policy.conditions.some((rule) => JSON.stringify(rule) === JSON.stringify({ 'Content-Type': 'video/mp4' })));

  const location = await store.locate(key);
  assert.ok(location && 'redirect' in location);
  const link = new URL(location.redirect);
  assert.equal(link.host, 'club-media-abc123.t3.storageapi.dev');
  assert.equal(link.pathname, `/${key}`);
  assert.equal(link.searchParams.get('X-Amz-Expires'), '3600');
  assert.ok(!location.redirect.includes('secret-example-value'));
});
