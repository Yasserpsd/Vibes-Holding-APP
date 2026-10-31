import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import Fastify, { type FastifyInstance } from 'fastify';
import sharp from 'sharp';

import type { AuthService } from './auth/service.js';
import { ImageVariants, pickWidth, qualityFor } from './media/images.js';
import { mediaRoutes } from './media/routes.js';
import { MediaService } from './media/service.js';
import { DiskMediaStore } from './media/store.js';

// M169 (owner, 2026-10-31, «اضغط الصور… عايز سرعة»): pictures leave resized, as WebP, straight from this
// server with a one-year cache header; the variant is kept in memory and in the store.

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return silentLog; } } as unknown as import('fastify').FastifyBaseLogger;

const KEY = 'posts/2026/10/0b7b61b2-719c-4534-92b1-0123456789ab.png';
let root: string;
let app: FastifyInstance;
let store: DiskMediaStore;
let original: Buffer;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'm169-'));
  store = new DiskMediaStore(root, 'http://localhost:3000');
  // A 2000×1200 photo-like gradient (noise keeps the encoder honest about size).
  original = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
    .png()
    .toBuffer();
  await store.put(KEY, original, 'image/png');
  const service = new MediaService({ store, origins: ['http://localhost:3000'], maxImageBytes: 10 * 1024 * 1024, maxVideoBytes: 100 * 1024 * 1024, enabled: true, referenced: async () => new Set(), sweepEnabled: false, log: silentLog });
  const variants = await ImageVariants.create(store, silentLog);
  assert.ok(variants, 'sharp loads on this machine');
  app = Fastify();
  await app.register(mediaRoutes, { service, auth: {} as AuthService, variants });
  await app.ready();
});

after(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

test('m169: the width ladder rounds up, caps at 1280 and defaults to 960', () => {
  assert.equal(pickWidth('320'), 320);
  assert.equal(pickWidth('333'), 480);
  assert.equal(pickWidth('5000'), 1280);
  assert.equal(pickWidth(undefined), 960);
  assert.equal(pickWidth('abc'), 960);
  assert.equal(pickWidth(['640', '160']), 640);
  assert.ok(qualityFor(320) < qualityFor(1280));
});

test('m169: ?w= answers a small WebP of that width, cacheable for a year, with an etag that yields 304', async () => {
  const first = await app.inject({ method: 'GET', url: `/media/${KEY}?w=320` });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['content-type'], 'image/webp');
  assert.equal(first.headers['cache-control'], 'public, max-age=31536000, immutable');
  const meta = await sharp(first.rawPayload).metadata();
  assert.equal(meta.width, 320);
  assert.equal(meta.height, 192);
  assert.ok(first.rawPayload.length < original.length / 20, `variant ${first.rawPayload.length} bytes vs original ${original.length}`);
  const etag = first.headers.etag;
  assert.ok(typeof etag === 'string' && etag.startsWith('"'));
  const again = await app.inject({ method: 'GET', url: `/media/${KEY}?w=320`, headers: { 'if-none-match': etag } });
  assert.equal(again.statusCode, 304);
  // The variant is persisted in the background next to the originals, outside posts/ (the sweep never lists it).
  const path = join(root, 'variants', 'v1', KEY.replace(/\.png$/, '.w320.webp'));
  for (let tries = 0; tries < 50 && !(await stat(path).catch(() => null)); tries += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok((await stat(path)).isFile());
});

test('m169: no width = 960 wide; nothing upsizes; raw=1 keeps the original bytes and type', async () => {
  const plain = await app.inject({ method: 'GET', url: `/media/${KEY}` });
  assert.equal(plain.statusCode, 200);
  assert.equal((await sharp(plain.rawPayload).metadata()).width, 960);
  const big = await app.inject({ method: 'GET', url: `/media/${KEY}?w=4000` });
  assert.equal((await sharp(big.rawPayload).metadata()).width, 1280);
  const raw = await app.inject({ method: 'GET', url: `/media/${KEY}?raw=1` });
  assert.equal(raw.statusCode, 200);
  assert.equal(raw.headers['content-type'], 'image/png');
  assert.equal(raw.rawPayload.length, original.length);
});

test('m169: a missing picture is still a 404 and a video key is never resized', async () => {
  const missing = await app.inject({ method: 'GET', url: '/media/posts/2026/10/0b7b61b2-719c-4534-92b1-0123456789ff.jpg?w=320' });
  assert.equal(missing.statusCode, 404);
  assert.equal(ImageVariants.resizable('posts/2026/10/0b7b61b2-719c-4534-92b1-0123456789ab.mp4'), false);
  assert.equal(ImageVariants.resizable('posts/2026/10/0b7b61b2-719c-4534-92b1-0123456789ab.gif'), false);
  assert.equal(ImageVariants.variantKey(KEY, 480), 'variants/v1/posts/2026/10/0b7b61b2-719c-4534-92b1-0123456789ab.w480.webp');
});
