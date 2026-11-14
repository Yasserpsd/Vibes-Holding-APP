import assert from 'node:assert/strict';
import { test } from 'node:test';

import { englishPayments } from './routes.js';

const words: Record<string, string> = { 'تصميم Pitch Deck': 'Pitch Deck design', 'اسم المشروع': 'Project name', 'منصة تعليمية': 'Learning platform' };
const english = { texts: async (list: string[]) => list.map((text) => words[text] ?? text) };
const payment = { id: 'p1', status: 'paid', serviceTitle: 'تصميم Pitch Deck', answers: [{ key: 'project', label: 'اسم المشروع', value: 'منصة تعليمية' }] };

test('M239: English payments carry the answers labels and values in English, status untouched', async () => {
  const [shown] = await englishPayments(english, [payment], 'en');
  assert.equal(shown?.serviceTitle, 'Pitch Deck design');
  assert.deepEqual(shown?.answers, [{ key: 'project', label: 'Project name', value: 'Learning platform', original: 'منصة تعليمية' }]);
  assert.equal(shown?.status, 'paid');
});

test('M239: Arabic requests and a missing translator keep the stored text', async () => {
  assert.equal((await englishPayments(english, [payment], 'ar'))[0]?.serviceTitle, 'تصميم Pitch Deck');
  assert.equal((await englishPayments(undefined, [payment], 'en'))[0]?.answers[0]?.label, 'اسم المشروع');
});
