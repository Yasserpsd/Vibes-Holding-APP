import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryKV } from '../store.js';
import { PersonaChangeStore } from './personaChange.js';

const CODE = '123456';

test('persona change: code confirms, stamp opens the membership-year window', async () => {
  const kv = new MemoryKV();
  const store = new PersonaChangeStore(kv, CODE);
  const mails: string[] = [];
  const deliver = async (code: string) => {
    mails.push(code);
  };

  // No change yet: the window is open.
  assert.equal(await store.daysLeft(7), 0);

  const requested = await store.request(7, 'investor', deliver);
  assert.deepEqual(requested, { ok: true, seconds: 600 });
  assert.deepEqual(mails, [CODE]);

  // A wrong code burns one of five attempts; the right one ends the request (single use).
  const wrong = await store.confirm(7, '000000');
  assert.deepEqual(wrong, { ok: false, reason: 'bad_code', attemptsLeft: 4 });
  const confirmed = await store.confirm(7, CODE);
  assert.deepEqual(confirmed, { ok: true, persona: 'investor' });
  assert.deepEqual(await store.confirm(7, CODE), { ok: false, reason: 'gone' });

  // The caller stamps after the hub applied the change: the member now waits a membership year (M109d).
  await store.stamp(7);
  assert.equal(await store.daysLeft(7), 365);
  const refused = await store.request(7, 'entrepreneur', deliver);
  assert.deepEqual(refused, { ok: false, reason: 'cooldown', daysLeft: 365 });
  // Another member is untouched by that stamp.
  assert.equal(await store.daysLeft(8), 0);
});

test('persona change: resend gap and locked after five wrong codes', async () => {
  const kv = new MemoryKV();
  const store = new PersonaChangeStore(kv, CODE);
  const deliver = async () => {};

  assert.deepEqual(await store.request(9, 'neutral', deliver), { ok: true, seconds: 600 });
  // A second mail straight away is refused (20-second gap).
  const tooSoon = await store.request(9, 'neutral', deliver);
  assert.equal(tooSoon.ok, false);
  assert.equal((tooSoon as { reason: string }).reason, 'too_soon');

  for (let attempt = 4; attempt >= 1; attempt -= 1) {
    const result = await store.confirm(9, '999999');
    assert.deepEqual(result, { ok: false, reason: 'bad_code', attemptsLeft: attempt });
  }
  assert.deepEqual(await store.confirm(9, '999999'), { ok: false, reason: 'locked' });
  // The request died with the lock; even the right code is gone now.
  assert.deepEqual(await store.confirm(9, CODE), { ok: false, reason: 'gone' });
});
