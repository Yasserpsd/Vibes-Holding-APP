import assert from 'node:assert/strict';
import { test } from 'node:test';

import { z } from 'zod';

import { fieldProblems } from './auth/guard.js';
import { localizeError } from './errorEnglish.js';
import { isWebLink, tidyLink } from './profiles/links.js';

const schema = z.object({
  name: z.string().trim().min(2, 'الاسم مطلوب').max(10),
  password: z.string().min(6, 'كلمة المرور 6 أحرف على الأقل'),
  persona: z.enum(['neutral', 'investor']),
  city: z.string(),
  lines: z.array(z.string().min(3, 'كل محطة في سطر مستقل، من 3 أحرف إلى 140 حرفًا')).max(2),
});

test('M253: a refused body names every refused field with its own sentence', () => {
  const result = schema.safeParse({ name: 'اسم طويل جدًا جدًا', password: '123', persona: 'other', lines: ['سطر سليم', 'س'] });
  assert.equal(result.success, false);
  if (result.success) return;
  const problems = fieldProblems(result.error.issues);
  const byField = Object.fromEntries(problems.map((problem) => [problem.field, problem]));
  assert.deepEqual(Object.keys(byField).sort(), ['city', 'lines', 'name', 'password', 'persona']);
  // The rule's own sentence stands; a rule without one gets a sentence from the kind of refusal.
  assert.equal(byField.password?.message, 'كلمة المرور 6 أحرف على الأقل');
  assert.equal(byField.name?.message, 'النص أطول من المسموح، الحد الأقصى للأحرف: 10');
  assert.equal(byField.city?.message, 'هذه الخانة مطلوبة');
  assert.equal(byField.persona?.message, 'اختر أحد الخيارات المتاحة في هذه الخانة');
  // The line of a list is named, so the app can say which line.
  assert.deepEqual([byField.lines?.path, byField.lines?.index], ['lines.1', 1]);
});

test('M253: the English app reads every field sentence in English', () => {
  const body = {
    error: {
      code: 'invalid',
      message: 'كلمة المرور 6 أحرف على الأقل',
      field: 'password',
      fields: [
        { field: 'password', path: 'password', message: 'كلمة المرور 6 أحرف على الأقل' },
        { field: 'name', path: 'name', message: 'النص أطول من المسموح، الحد الأقصى للأحرف: 10' },
        { field: 'other', path: 'other', message: 'جملة جديدة بلا مقابل' },
      ],
    },
  };
  assert.equal(localizeError(body, 'ar'), body);
  const english = localizeError(body, 'en').error;
  assert.equal(english.message, 'The password must be at least 6 characters.');
  assert.deepEqual(
    english.fields.map((entry) => entry.message),
    ['The password must be at least 6 characters.', 'The text is too long; the limit is 10 characters.', 'This field is incomplete or not valid.'],
  );
  assert.equal(english.fields[0]?.field, 'password');
});

test('M253: a typed link is put right where there is one right answer', () => {
  const cases: [label: string, url: string, expected: string][] = [
    ['', 'instagram.com/name', 'https://instagram.com/name'],
    ['', 'instagram: io.binHattan', 'https://instagram.com/io.binHattan'],
    ['Instagram', '@io.binHattan', 'https://instagram.com/io.binHattan'],
    ['انستقرام', 'io.binHattan', 'https://instagram.com/io.binHattan'],
    ['LinkedIn', 'elham-a', 'https://linkedin.com/in/elham-a'],
    ['X', '@club', 'https://x.com/club'],
    ['', 'https://example.com/a b', 'https://example.com/ab'],
    ['instagram', 'https://instagram.com/name', 'https://instagram.com/name'],
    ['موقعي', 'example.com', 'https://example.com'],
  ];
  for (const [label, url, expected] of cases) {
    const tidy = tidyLink({ label, url });
    assert.equal(tidy.url, expected, `${label} | ${url}`);
    assert.ok(isWebLink(tidy.url), expected);
  }
  assert.equal(tidyLink({ label: '', url: 'instagram: io.binHattan' }).label, 'instagram');
  // What has no one right answer is still refused, by name.
  assert.equal(isWebLink(tidyLink({ label: '', url: '@name' }).url), false);
  assert.equal(isWebLink(tidyLink({ label: '', url: 'لا يوجد' }).url), false);
});
