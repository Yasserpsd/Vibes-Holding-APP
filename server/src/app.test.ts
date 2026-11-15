import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { GOLDEN_SEED, ensureGoldenSeed } from './content/golden.js';
import { MOCK_CODE } from './hub/mock.js';
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

/** Everything the detailed health answer carries beyond the public three keys. */
const HEALTH_DETAIL_KEYS = ['storage', 'projectsBank', 'hub', 'news', 'golden', 'videos', 'mail', 'payments', 'membership', 'push', 'uploads', 'backup', 'bridge'];

test('public health says only that the server is up', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(Object.keys(body).sort(), ['env', 'ok', 'time']);
  assert.deepEqual([body.ok, body.env], [true, 'test']);
  assert.ok(!Number.isNaN(Date.parse(body.time)), body.time);
  for (const key of HEALTH_DETAIL_KEYS) assert.equal(key in body, false, key);
});

test('the health detail needs a dashboard session and reports the cached feed', async () => {
  const guest = await app.inject({ method: 'GET', url: '/api/admin/health' });
  assert.equal(guest.statusCode, 401);
  assert.equal(guest.headers['cache-control'], 'no-store');

  // Every verified account of the mock hub is an admin.
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'سالم العتيبي', country: 'sa', phone: '0558318731', email: 'health.admin@gmail.com', password: 'secret123', persona: 'neutral', bio: 'حساب إدارة لاختبار حالة الخادم.' },
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  assert.equal(verified.statusCode, 200, verified.body);

  const res = await app.inject({ method: 'GET', url: '/api/admin/health', headers: { authorization: `Bearer ${verified.json().token as string}` } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers['cache-control'], 'no-store');
  const body = res.json();
  assert.deepEqual(Object.keys(body).sort(), ['env', 'ok', 'time', ...HEALTH_DETAIL_KEYS].sort());
  assert.equal(body.projectsBank.count, 3);
  // The plugin test rig (phase D) reads this field before and after a Projects Bank webhook.
  assert.equal(body.projectsBank.updatedAt, snapshot.fetchedAt);
  assert.equal(body.hub.mode, 'mock');

  // The router percent-decodes a path before matching it, so an escaped spelling is the same route:
  // guarded and no-store all the same (the raw text of the URL is not what decides).
  const escapedGuest = await app.inject({ method: 'GET', url: '/%61pi/admin/health' });
  assert.deepEqual([escapedGuest.statusCode, escapedGuest.headers['cache-control']], [401, 'no-store']);
  const escaped = await app.inject({ method: 'GET', url: '/%61pi/admin/health', headers: { authorization: `Bearer ${verified.json().token as string}` } });
  assert.equal(escaped.statusCode, 200, escaped.body);
  assert.equal(escaped.json().hub.mode, 'mock');
  assert.equal(escaped.headers['cache-control'], 'no-store');
});

test('an escaped spelling of /api/ stays no-store', async () => {
  const list = await app.inject({ method: 'GET', url: '/ap%69/projects' });
  assert.deepEqual([list.statusCode, list.headers['cache-control']], [200, 'no-store']);
  // No route matched: judged on the decoded path.
  const unknown = await app.inject({ method: 'GET', url: '/%61pi/nothing-here' });
  assert.deepEqual([unknown.statusCode, unknown.headers['cache-control']], [404, 'no-store']);
});

test('HSTS is sent by the deployed service only', async () => {
  // The test runner, like a local server, answers over plain http: no header anywhere.
  for (const url of ['/health', '/api/projects', '/pay/return', '/nothing']) {
    assert.equal((await app.inject({ method: 'GET', url })).headers['strict-transport-security'], undefined, url);
  }

  // Railway names the public domain of the production and the test deployments alike; both sit behind https.
  const deployed = (await buildApp({ config: loadConfig({ LOG_LEVEL: 'silent', RAILWAY_PUBLIC_DOMAIN: 'api-test.example.com' }), kv: new MemoryKV() })).app;
  try {
    for (const url of ['/health', '/api/projects', '/api/admin/health', '/pay/return', '/nothing']) {
      assert.equal((await deployed.inject({ method: 'GET', url })).headers['strict-transport-security'], 'max-age=31536000', url);
    }
  } finally {
    await deployed.close();
  }
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
  // M116 added «الأعلى تقييمًا» to the four original sorts.
  assert.equal(filters.json().sorts.length, 5);
});

test('serves the seeded golden portal', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/golden' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().companies.length, 10);
  assert.equal(res.json().portfolioValueSarMillions, GOLDEN_SEED.portfolioValueSarMillions);
});
