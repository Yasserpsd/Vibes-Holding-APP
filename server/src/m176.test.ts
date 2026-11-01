import assert from 'node:assert/strict';
import { test } from 'node:test';

import { firstName, tipFor } from './companion/tips.js';
import { DiscountsService, monthlyCode } from './discounts/service.js';
import { MemoryKV } from './store.js';

// 2026-11-15 12:00 Riyadh.
const NOV = Date.parse('2026-11-15T09:00:00Z');

test('M176: the monthly code renames itself per Riyadh month and ends on the last day', () => {
  assert.deepEqual(monthlyCode('DEAL', NOV), { code: 'NOVDEAL', endsAt: '2026-11-30' });
  // 23:30 UTC on 30 Nov is already 1 Dec in Riyadh.
  assert.equal(monthlyCode('DEAL', Date.parse('2026-11-30T23:30:00Z')).code, 'DECDEAL');
  assert.equal(monthlyCode('DEAL', Date.parse('2027-02-10T09:00:00Z')).endsAt, '2027-02-28');
});

test('M176: the active monthly code applies without being created, and only in its month', async () => {
  const discounts = new DiscountsService({ kv: new MemoryKV() });
  const active = await discounts.activeMonthly(NOV);
  assert.deepEqual(active, { code: 'NOVDEAL', endsAt: '2026-11-30', percent: 10 });
  const applied = await discounts.apply('novdeal', 1200, NOV);
  assert.deepEqual(applied, { code: 'NOVDEAL', percent: 10, amountBefore: 1200, amountAfter: 1080 });
  await assert.rejects(discounts.apply('OCTDEAL', 1200, NOV));

  await discounts.setMonthlySettings({ percent: 20 });
  assert.equal((await discounts.apply('NOVDEAL', 1000, NOV)).amountAfter, 800);
  await discounts.setMonthlySettings({ enabled: false });
  assert.equal(await discounts.activeMonthly(NOV), null);
  await assert.rejects(discounts.apply('NOVDEAL', 1000, NOV));
  await assert.rejects(discounts.setMonthlySettings({ percent: 95 }));
});

test('M176: the daily tip greets by first name and follows membership and persona', () => {
  assert.equal(firstName('  محمد عبدالله '), 'محمد');
  const context = { project: 'مشروع النخبة', sector: 'التقنية', deal: 'NOVDEAL', percent: '10' };
  const seen = new Set<string>();
  for (let day = 0; day < 40; day += 1) {
    const tip = tipFor({ persona: 'entrepreneur', member: true, name: 'سارة', lang: 'ar', seed: 7 }, day, context);
    assert.ok(tip);
    assert.ok(tip.title.startsWith('سارة'), tip.title);
    assert.ok(!/مجان/u.test(tip.title + tip.body));
    // Investor-only and guest-only tips never reach a member entrepreneur.
    assert.notEqual(tip.key, 'credit');
    assert.notEqual(tip.key, 'membership');
    seen.add(tip.key);
  }
  assert.ok(seen.size >= 8, `the rotation walks the services (${seen.size})`);

  const guest = tipFor({ persona: 'investor', member: false, name: '', lang: 'en', seed: 3 }, 1, context);
  assert.ok(guest && !guest.title.startsWith(','));
  assert.equal(guest.title.charAt(0), guest.title.charAt(0).toUpperCase());
});
