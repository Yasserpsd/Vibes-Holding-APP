import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EnglishCache } from '../englishCache.js';
import { MemoryKV } from '../store.js';
import { NameTransliterator } from './namesEnglish.js';

test('English names: Arabic names are transliterated once and cached; Latin and Arabic-app names pass through', async () => {
  let calls = 0;
  const translator = {
    mode: 'openai' as const,
    async translate(texts: string[]) {
      calls += 1;
      return texts.map((text) => (text === 'محمد عبدالله' ? 'Mohammed Abdullah' : 'Sara Ali'));
    },
  };
  const names = new NameTransliterator(new MemoryKV(), translator);
  assert.deepEqual(await names.names(['محمد عبدالله', 'John Smith', 'سارة علي', 'محمد عبدالله'], 'en'), ['Mohammed Abdullah', 'John Smith', 'Sara Ali', 'Mohammed Abdullah']);
  assert.equal(calls, 1);
  assert.deepEqual(await names.names(['محمد عبدالله'], 'en'), ['Mohammed Abdullah']);
  assert.equal(calls, 1);
  assert.deepEqual(await names.names(['محمد عبدالله'], 'ar'), ['محمد عبدالله']);
});

test('English names: a failed translation keeps the registered names', async () => {
  const names = new NameTransliterator(new MemoryKV(), { mode: 'off' as const, translate: async () => null });
  assert.deepEqual(await names.names(['محمد عبدالله'], 'en'), ['محمد عبدالله']);
});

test('English cache: rows rewrite only the chosen fields, and only in English', async () => {
  const cache = new EnglishCache(new MemoryKV(), { mode: 'openai' as const, translate: async (texts: string[]) => texts.map((text) => (text === 'اليوم الأول' ? 'Day one' : 'Slides — day one')) });
  const rows = [{ title: 'اليوم الأول', videoId: 'v1' }, { title: 'ملف العرض — اليوم الأول', videoId: 'v2' }];
  assert.deepEqual(await cache.rows(rows, ['title'], 'en'), [{ title: 'Day one', videoId: 'v1' }, { title: 'Slides — day one', videoId: 'v2' }]);
  assert.equal(await cache.rows(rows, ['title'], 'ar'), rows);
});
