import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HQ_SEED } from '../content/hq.js';
import { bookableDays, passState, riyadhNow, slotTimes, slotWindow, weekdayOf } from './service.js';

// Saturday 2026-09-12 21:30 Riyadh = 18:30 UTC.
const NOW = Date.parse('2026-09-12T18:30:00Z');

test('riyadh clock and bookable days follow the Riyadh calendar and the working days', () => {
  assert.deepEqual(riyadhNow(NOW), { date: '2026-09-12', minutes: 21 * 60 + 30 });
  assert.equal(weekdayOf('2026-09-12'), 6);
  const days = bookableDays(HQ_SEED, NOW);
  // Tomorrow (Sunday) first; Fridays and Saturdays are skipped; the window ends at maxDaysAhead.
  assert.equal(days[0]?.date, '2026-09-13');
  assert.ok(days.every((day) => HQ_SEED.hours.days.includes(day.weekday)));
  assert.ok(!days.some((day) => day.date === '2026-09-18' || day.date === '2026-09-19'));
  assert.ok(days.every((day) => day.date <= '2026-10-12'));
});

test('slot times cover the working hours in slot steps', () => {
  const times = slotTimes(HQ_SEED);
  assert.equal(times[0], '10:00');
  assert.equal(times[times.length - 1], '16:00');
  assert.equal(times.length, 7);
});

test('pass windows: 15 minutes of grace before the slot, expired after it', () => {
  const visit = { date: '2026-09-13', time: '10:00' };
  const { start, end } = slotWindow(visit.date, visit.time, 60);
  assert.equal(start.toISOString(), '2026-09-13T07:00:00.000Z');
  assert.equal(end.toISOString(), '2026-09-13T08:00:00.000Z');
  assert.equal(passState(visit, 60, Date.parse('2026-09-13T06:40:00Z')).state, 'upcoming');
  assert.equal(passState(visit, 60, Date.parse('2026-09-13T06:50:00Z')).state, 'active');
  assert.equal(passState(visit, 60, Date.parse('2026-09-13T07:59:00Z')).state, 'active');
  assert.equal(passState(visit, 60, Date.parse('2026-09-13T08:01:00Z')).state, 'expired');
});
