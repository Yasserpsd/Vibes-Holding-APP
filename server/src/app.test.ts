import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { GOLDEN_SEED, ensureGoldenSeed } from './content/golden.js';
import { SNAPSHOT_KEY } from './projectsBank/service.js';
import type { FeedSnapshot, PublicProject } from './projectsBank/types.js';
import { MemoryKV } from './store.js';

const project = (overrides: Partial<PublicProject>): PublicProject => ({
  id: 1,
  number: null,
  slug: null,
  title: 'مشروع',
  titleEn: null,
  companyName: null,
  companyNameEn: null,
  founderName: null,
  founderNameEn: null,
  excerpt: null,
  excerptEn: null,
  details: null,
  detailsEn: null,
  image: null,
  gallery: [],
  sector: null,
  stage: null,
  isGolden: false,
  featuredOrder: null,
  goldenPartnerUrl: null,
  hasPitchDeck: false,
  contactRule: null,
  viewsCount: 0,
  modifiedAt: null,
  ...overrides,
});

const snapshot: FeedSnapshot = {
  fetchedAt: '2026-09-11T00:00:00.000Z',
  projects: [
    project({ id: 1, title: 'تطبيق توصيل', sector: { slug: 'tech', name: 'تقنية' }, viewsCount: 5, modifiedAt: '2026-01-01T00:00:00.000Z' }),
    project({ id: 2, title: 'مطعم', titleEn: 'Restaurant', sector: { slug: 'food', name: 'أغذية' }, viewsCount: 50, modifiedAt: '2026-02-01T00:00:00.000Z' }),
    project({ id: 3, title: 'مصنع', isGolden: true, featuredOrder: 1, viewsCount: 9, modifiedAt: '2025-12-01T00:00:00.000Z' }),
  ],
};

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];

before(async () => {
  await kv.set(SNAPSHOT_KEY, snapshot);
  await ensureGoldenSeed(kv);
  const built = await buildApp({ config, kv });
  app = built.app;
  await built.projects.start();
});

after(async () => {
  await app.close();
});

test('health reports the cached feed', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().projectsBank.count, 3);
});

test('lists projects newest first with no-store caching', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const body = res.json();
  assert.deepEqual(body.items.map((item: PublicProject) => item.id), [2, 1, 3]);
  assert.equal(body.total, 3);
  assert.equal(body.hasMore, false);
});

test('searches in Arabic and English, filters and sorts', async () => {
  const search = await app.inject({ method: 'GET', url: '/api/projects?q=restaurant' });
  assert.deepEqual(search.json().items.map((item: PublicProject) => item.id), [2]);

  const arabic = await app.inject({ method: 'GET', url: '/api/projects?q=توصيل' });
  assert.deepEqual(arabic.json().items.map((item: PublicProject) => item.id), [1]);

  const sector = await app.inject({ method: 'GET', url: '/api/projects?sector=food' });
  assert.deepEqual(sector.json().items.map((item: PublicProject) => item.id), [2]);

  const views = await app.inject({ method: 'GET', url: '/api/projects?sort=views' });
  assert.deepEqual(views.json().items.map((item: PublicProject) => item.id), [2, 3, 1]);

  const golden = await app.inject({ method: 'GET', url: '/api/projects?sort=golden&limit=1' });
  assert.deepEqual(golden.json().items.map((item: PublicProject) => item.id), [3]);
  assert.equal(golden.json().hasMore, true);
});

test('rejects invalid queries and unknown projects', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects?sort=nope' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects/abc' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects/999' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/nothing' })).statusCode, 404);
});

test('returns a project and the filters', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/projects/2' });
  assert.equal(res.json().project.titleEn, 'Restaurant');

  const filters = await app.inject({ method: 'GET', url: '/api/projects/filters' });
  assert.deepEqual(filters.json().sectors.map((option: { slug: string }) => option.slug).sort(), ['food', 'tech']);
  assert.equal(filters.json().sorts.length, 4);
});

test('serves the seeded golden portal', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/golden' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().companies.length, 10);
  assert.equal(res.json().portfolioValueSarMillions, GOLDEN_SEED.portfolioValueSarMillions);
});
