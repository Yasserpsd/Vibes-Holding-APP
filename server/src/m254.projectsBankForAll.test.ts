import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ensureHomeSeed, getHomeContent, HOME_CONTENT_KEY, HOME_SEED, type HomeContent } from './content/home.js';
import { MemoryKV } from './store.js';

test('M254: the Projects Bank is the same for every category — no persona loses its tab, and the entrepreneur has its block', () => {
  for (const key of ['guest', 'neutral', 'entrepreneur', 'investor'] as const) {
    const variant = HOME_SEED.personas?.[key];
    assert.ok(!(variant?.hideTabs ?? []).includes('projects'), `${key} keeps the Projects Bank tab`);
  }
  // The neutral and the entrepreneur read the block on their home; the investor's home opens with the golden
  // opportunity instead (M102, his own request) and the full bank lives in his tab.
  for (const key of ['guest', 'neutral', 'entrepreneur'] as const) {
    const variant = HOME_SEED.personas?.[key];
    assert.ok(variant?.order?.includes('projectsBank'), `${key} has the block in his order`);
    assert.ok(!(variant?.hide ?? []).includes('projectsBank'), `${key} does not hide the block`);
  }
  assert.equal(HOME_SEED.personas?.entrepreneur?.ctas?.projectsBank?.route, '/projects');
});

test('M254: a server that still stores the older home content takes the new one at its next start', async () => {
  const kv = new MemoryKV();
  const older: HomeContent = { ...HOME_SEED, version: HOME_SEED.version - 1, personas: { ...HOME_SEED.personas, entrepreneur: { hide: ['projectsBank'], hideTabs: ['projects'] } } };
  await kv.set(HOME_CONTENT_KEY, older);
  assert.equal(await ensureHomeSeed(kv), true);
  const stored = await getHomeContent(kv);
  assert.deepEqual(stored.personas?.entrepreneur?.hideTabs ?? [], []);
  assert.equal((await getHomeContent(kv, 'en')).personas?.entrepreneur?.ctas?.projectsBank?.label, 'Browse all the projects of the bank');
});
