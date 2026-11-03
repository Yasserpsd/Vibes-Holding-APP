import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import Fastify from 'fastify';

import type { AuthService } from './auth/service.js';
import { BunnyStream, signDirectory } from './media/bunny.js';
import { mediaRoutes } from './media/routes.js';
import { MediaService } from './media/service.js';
import { DiskMediaStore } from './media/store.js';

const ORIGIN = 'https://api.example.test';
const ID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const LIBRARY = '123456';
const KEY = 'library-api-key-for-tests';

let dir = '';
let calls: { method: string; url: string; body?: string }[] = [];
let video: { status: number; availableResolutions: string } | null = null;

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  calls.push({ method: init?.method ?? 'GET', url, body: init?.body as string | undefined });
  assert.equal((init?.headers as Record<string, string>).AccessKey, KEY);
  if (init?.method === 'POST') return Response.json({ guid: ID });
  if (!video) return new Response('', { status: 404 });
  return Response.json(video);
};

function service(tokenKey?: string): MediaService {
  return new MediaService({
    store: new DiskMediaStore(dir, ORIGIN),
    origins: [ORIGIN],
    maxImageBytes: 10 * 1024 * 1024,
    maxVideoBytes: 200 * 1024 * 1024,
    stream: new BunnyStream({ libraryId: LIBRARY, apiKey: KEY, cdnHost: 'vz-test.b-cdn.net', tokenKey, fetch: fakeFetch }),
    maxStreamBytes: 20 * 1024 * 1024 * 1024,
    enabled: true,
    referenced: async () => new Set(),
    sweepEnabled: false,
    log: Fastify().log,
  });
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'm189-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('a video upload becomes a Bunny video with a signed TUS ticket; images stay in the store', async () => {
  calls = [];
  const media = service();
  const now = new Date('2026-11-03T12:00:00Z');
  const upload = await media.createUpload({ filename: 'open-day-4k.mp4', contentType: 'video/mp4', size: 8 * 1024 * 1024 * 1024 }, now);
  assert.equal(upload.key, `stream/${ID}`);
  assert.equal(upload.url, `${ORIGIN}/media/stream/${ID}/playlist.m3u8`);
  assert.equal(upload.upload.method, 'TUS');
  const headers = (upload.upload as { headers: Record<string, string> }).headers;
  const expires = String(now.getTime() / 1000 + 24 * 3600);
  assert.deepEqual(headers, {
    AuthorizationSignature: createHash('sha256').update(LIBRARY + KEY + expires + ID).digest('hex'),
    AuthorizationExpire: expires,
    VideoId: ID,
    LibraryId: LIBRARY,
  });
  assert.equal(calls[0]?.url, `https://video.bunnycdn.com/library/${LIBRARY}/videos`);
  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { title: 'open-day-4k.mp4' });
  assert.ok(!JSON.stringify(upload).includes(KEY), 'the API key never reaches the browser');

  const image = await media.createUpload({ filename: 'a.png', contentType: 'image/png', size: 1000 }, now);
  assert.notEqual(image.upload.method, 'TUS');
  assert.equal(calls.length, 1);
  assert.equal(media.config().videos.maxBytes, 20 * 1024 * 1024 * 1024);
});

test('a post may carry the video once Bunny has a playable resolution', async () => {
  const media = service();
  const url = media.streamUrl(ID);
  video = null;
  await assert.rejects(media.check(url, 'video'), /لم يكتمل رفع الفيديو/);
  video = { status: 3, availableResolutions: '' };
  await assert.rejects(media.check(url, 'video'), /قيد المعالجة/);
  video = { status: 5, availableResolutions: '' };
  await assert.rejects(media.check(url, 'video'), /تعذّرت معالجة الفيديو/);
  video = { status: 3, availableResolutions: '360p,720p' };
  await media.check(url, 'video');
  video = { status: 4, availableResolutions: '360p,720p,1080p,2160p' };
  await media.check(url, 'video');
  await media.check(media.posterFor(url) ?? '', 'image');
  await assert.rejects(media.check(`https://evil.test/media/stream/${ID}/playlist.m3u8`, 'video'), /غير صالح/);
});

test('/media/stream redirects to the CDN, signed per directory when a token key is set', async () => {
  const plain = Fastify();
  await plain.register(mediaRoutes, { service: service(), auth: {} as AuthService });
  const open = await plain.inject({ method: 'GET', url: `/media/stream/${ID}/playlist.m3u8` });
  assert.equal(open.statusCode, 302);
  assert.equal(open.headers.location, `https://vz-test.b-cdn.net/${ID}/playlist.m3u8`);
  assert.equal((await plain.inject({ method: 'GET', url: `/media/stream/${ID}/original` })).statusCode, 404);
  assert.equal((await plain.inject({ method: 'GET', url: '/media/stream/not-an-id/playlist.m3u8' })).statusCode, 404);

  const signed = Fastify();
  await signed.register(mediaRoutes, { service: service('pull-zone-token-key'), auth: {} as AuthService });
  const location = String((await signed.inject({ method: 'GET', url: `/media/stream/${ID}/thumbnail.jpg` })).headers.location);
  assert.match(location, new RegExp(`^https://vz-test\\.b-cdn\\.net/bcdn_token=[A-Za-z0-9_-]+&token_path=%2F${ID}%2F&expires=\\d+/${ID}/thumbnail\\.jpg$`));

  const expires = 1_800_000_000;
  const token = createHash('sha256').update(`key/${ID}/${expires}token_path=/${ID}/`).digest('base64url');
  assert.equal(signDirectory('h.b-cdn.net', 'key', ID, 'playlist.m3u8', expires), `https://h.b-cdn.net/bcdn_token=${token}&token_path=%2F${ID}%2F&expires=${expires}/${ID}/playlist.m3u8`);
});
