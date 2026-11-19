import assert from 'node:assert/strict';
import { test } from 'node:test';

import { z } from 'zod';

import { refusedField } from './auth/guard.js';
import { RefusalCounter, reasonLabel } from './auth/refusals.js';
import { MemoryKV } from './store.js';

const DAY = 24 * 60 * 60_000;

test('M255: refused sign-ups are counted by step, cause, field and platform — and nothing else is stored', async () => {
  const kv = new MemoryKV();
  let now = Date.parse('2026-11-19T10:00:00.000Z');
  const counter = new RefusalCounter(kv, () => now);
  counter.passed('register', 'ios');
  counter.passed('register', 'android');
  counter.refused('register', 'invalid', 'ios', 'email');
  counter.refused('register', 'invalid', 'android', 'email');
  counter.refused('register', 'invalid', 'ios', 'email');
  counter.refused('register', 'exists', 'ios');
  counter.refused('login', 'bad_login', 'android');
  counter.refused('login', 'a code with spaces!', 'web');
  // An older day inside the window, and one outside it.
  now -= 3 * DAY;
  counter.refused('register', 'exists', 'android');
  now -= 30 * DAY;
  counter.refused('register', 'exists', 'android');
  now = Date.parse('2026-11-19T10:00:00.000Z');

  const report = await counter.report(7);
  assert.deepEqual([report.days, report.from, report.to], [7, '2026-11-13', '2026-11-19']);
  const register = report.steps.find((step) => step.step === 'register');
  assert.deepEqual([register?.label, register?.passed, register?.refused], ['إنشاء حساب جديد', 2, 5]);
  // The commonest cause first; a cause is a plain Arabic sentence, never a code.
  assert.deepEqual(
    register?.reasons.map((reason) => [reason.label, reason.count, reason.ios, reason.android]),
    [
      ['خانة غير صحيحة: البريد الإلكتروني', 3, 2, 1],
      ['الحساب موجود مسبقًا (البريد أو الجوال مسجّل)', 2, 1, 1],
    ],
  );
  const login = report.steps.find((step) => step.step === 'login');
  assert.deepEqual(login?.reasons.map((reason) => reason.label).sort(), ['البريد أو الجوال أو كلمة المرور غير صحيحة', 'سبب آخر'].sort());
  assert.equal(reasonLabel('invalid', 'unknownField'), 'خانة غير صحيحة: خانة أخرى');

  // What is stored: counters under a day, keyed by step|code|field|platform.
  const stored = await kv.get<{ counts: Record<string, number> }>('auth:refusals:2026-11-19');
  assert.deepEqual(Object.keys(stored?.counts ?? {}).sort(), ['login|bad_login||android', 'login|other||other', 'register|exists||ios', 'register|invalid|email|android', 'register|invalid|email|ios', 'register|ok||android', 'register|ok||ios']);
});

test('M255: the refused field of a body is its first refused field', () => {
  const schema = z.object({ name: z.string().min(2), email: z.string().min(6) });
  assert.equal(refusedField(schema, { name: 'Ali Hassan', email: 'x' }), 'email');
  assert.equal(refusedField(schema, { name: 'Ali Hassan', email: 'ali@example.com' }), '');
  assert.equal(refusedField(schema, null), '');
});
