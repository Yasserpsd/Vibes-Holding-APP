import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MOCK_CODE, MockHubClient } from '../hub/mock.js';
import { MemoryKV } from '../store.js';
import { ensureGoldenSeed, GOLDEN_CONTENT_KEY, GOLDEN_SEED, type GoldenContent } from './golden.js';

/** M121: the owner's «فرصة Vibes Ventures» entry that leads the home opportunity slot. */

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', NEWS_REFRESH_MINUTES: '0' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let token = '';

before(async () => {
  app = (await buildApp({ config, kv, hub: new MockHubClient() })).app;
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'يوسف الدوسري', country: 'sa', phone: '0558318719', email: 'm121.admin@gmail.com', password: 'secret123', persona: 'neutral', bio: 'حساب لاختبار فرصة Vibes Ventures.' } });
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  token = verified.json().token as string;
});

after(async () => {
  await app.close();
});

const get = (url: string, lang?: string) => app.inject({ method: 'GET', url, headers: lang ? { 'x-app-lang': lang } : {} });
const put = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'PUT', url, payload, headers: { authorization: `Bearer ${token}` } });

test('the golden block always carries the opportunity, seeded with Vibes Ventures, in both languages', async () => {
  const arabic = (await get('/api/golden')).json();
  assert.equal(arabic.opportunity.badge, 'فرصة Vibes Ventures');
  assert.equal(arabic.opportunity.valuationSarMillions, 161);
  assert.equal(arabic.opportunity.ctaUrl, 'https://vibesholding.com/offer/');
  assert.equal(arabic.opportunity.imageUrl, null, 'no photo until the owner fills the slot');

  const english = (await get('/api/golden', 'en')).json();
  assert.equal(english.opportunity.title, 'The Vibes Ventures investment portfolio');
  assert.equal(english.opportunity.ctaLabel, 'Discover the opportunity');
  assert.equal(english.opportunity.ctaUrl, arabic.opportunity.ctaUrl, 'links are language-free');
});

test('a stored pre-M121 block gets the opportunity grafted without losing the owner values', async () => {
  const oldBlock: Record<string, unknown> = { ...GOLDEN_SEED, portfolioValueSarMillions: 200 };
  delete oldBlock.opportunity;
  await kv.set(GOLDEN_CONTENT_KEY, oldBlock);

  assert.equal((await get('/api/golden')).json().opportunity.badge, 'فرصة Vibes Ventures', 'read-time graft before the boot migration');

  assert.equal(await ensureGoldenSeed(kv), true, 'the migration writes once');
  const stored = await kv.get<GoldenContent>(GOLDEN_CONTENT_KEY);
  assert.equal(stored?.opportunity.title, GOLDEN_SEED.opportunity.title);
  assert.equal(stored?.portfolioValueSarMillions, 200, 'the owner-edited value survives');
  assert.equal(await ensureGoldenSeed(kv), false, 'and never twice');
});

test('the dashboard edits the opportunity texts, link and photo like every other block', async () => {
  const text = await put('/api/admin/content', { block: 'golden', path: 'opportunity.title', lang: 'ar', value: 'فرصة الشهر من Vibes Ventures' });
  assert.equal(text.statusCode, 200, text.payload);
  assert.equal((await get('/api/golden')).json().opportunity.title, 'فرصة الشهر من Vibes Ventures');

  const link = await put('/api/admin/content/value', { block: 'golden', path: 'opportunity.ctaUrl', value: 'https://wdeny.com/offer/' });
  assert.equal(link.statusCode, 200, link.payload);
  assert.equal((await get('/api/golden')).json().opportunity.ctaUrl, 'https://wdeny.com/offer/');

  const photo = await put('/api/admin/content/image', { key: 'golden.opportunity', url: 'https://example.com/media/opportunity.jpg' });
  assert.equal(photo.statusCode, 200, photo.payload);
  assert.equal((await get('/api/golden')).json().opportunity.imageUrl, 'https://example.com/media/opportunity.jpg');

  const cleared = await put('/api/admin/content/image', { key: 'golden.opportunity', url: null });
  assert.equal(cleared.statusCode, 200, cleared.payload);
  assert.equal((await get('/api/golden')).json().opportunity.imageUrl, null);
});
