import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CompanionService } from './companion/service.js';
import { tipFor } from './companion/tips.js';
import { isArabic } from './content/i18n.js';
import { MemoryKV } from './store.js';

const arabicOnly = { title: 'مشروع النخبة', titleEn: null, sector: { name: 'التقنية', slug: 'tech' } };
const english = { title: 'مشروع الصقر', titleEn: 'Falcon Logistics', sector: { name: 'الخدمات اللوجستية والنقل', slug: 'logistics' } };

function serviceWith(items: unknown[]): CompanionService {
  return new CompanionService({
    kv: new MemoryKV(),
    log: { warn: () => undefined, info: () => undefined, error: () => undefined } as never,
    config: {} as never,
    push: {} as never,
    agenda: {} as never,
    projects: { list: () => ({ items }) } as never,
  });
}

test('M239: the English tip names the localized project and sector, never an Arabic pick', async () => {
  const service = serviceWith([arabicOnly, english]);
  const seen = new Set<string>();
  for (let seed = 1; seed <= 12; seed += 1) {
    for (const tip of await service.tipsFor({ id: seed, name: 'سارة العتيبي', nameEn: 'Sara Alotaibi', persona: 'investor', member: true }, 'en', 14)) {
      assert.ok(!isArabic(tip.title) && !isArabic(tip.body), `${tip.key}: ${tip.body}`);
      if (tip.key === 'project') {
        seen.add(tip.body);
        assert.ok(tip.body.includes('Falcon Logistics') && tip.body.includes('Logistics and Transport'), tip.body);
      }
    }
  }
  assert.ok(seen.size > 0, 'the project tip appears');
});

test('M239: with no clean English pick the project tip drops out instead of printing Arabic', async () => {
  const service = serviceWith([arabicOnly]);
  for (let seed = 1; seed <= 12; seed += 1) {
    for (const tip of await service.tipsFor({ id: seed, name: 'سارة العتيبي', nameEn: null, persona: 'investor', member: false }, 'en', 14)) {
      assert.notEqual(tip.key, 'project');
      assert.ok(!isArabic(tip.title) && !isArabic(tip.body));
    }
  }
});

test('M239: an Arabic name or value in English mode is dropped; Arabic mode is untouched', () => {
  const tip = tipFor({ persona: 'investor', member: true, name: 'سارة', lang: 'en', seed: 0 }, 0, { project: 'مشروع النخبة', sector: 'التقنية', deal: 'VIP10', percent: '10' });
  assert.ok(tip && !isArabic(tip.title) && !isArabic(tip.body));
  const ar = tipFor({ persona: 'investor', member: true, name: 'سارة', lang: 'ar', seed: 0 }, 0, { project: 'مشروع النخبة', sector: 'التقنية', deal: null, percent: null });
  assert.ok(ar);
});
