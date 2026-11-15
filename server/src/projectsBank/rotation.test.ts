import assert from 'node:assert/strict';
import { test } from 'node:test';

import Fastify from 'fastify';

import { loadConfig } from '../config.js';
import { MemoryKV } from '../store.js';
import { dayOrder, ProjectsService, rotationDay, rotationTurned, SNAPSHOT_KEY } from './service.js';
import type { PublicProject } from './types.js';

// M242 (owner, 2026-11-16: «أيوه غيّره»): the Projects Bank deals its opening order again every Riyadh day —
// «اكتشف» and the unrated tail of «الأعلى تقييمًا» — and a list opened before midnight keeps its order to the end.
const log = Fastify({ logger: false }).log;
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });

function project(id: number): PublicProject {
  return {
    id,
    number: `P-${id}`,
    slug: `p-${id}`,
    title: `مشروع رقم ${id}`,
    titleEn: null,
    companyName: null,
    companyNameEn: null,
    founderName: null,
    founderNameEn: null,
    excerpt: null,
    excerptEn: null,
    details: null,
    detailsEn: null,
    image: null,
    gallery: [],
    sector: null,
    stage: null,
    isGolden: false,
    featuredOrder: null,
    goldenPartnerUrl: null,
    hasPitchDeck: false,
    contactRule: null,
    viewsCount: 0,
    // Older ids were edited earlier: the «latest» order is 60, 59, … 1.
    modifiedAt: new Date(Date.UTC(2026, 0, 1) + id * 86_400_000).toISOString(),
  };
}

const SIXTY = Array.from({ length: 60 }, (_, index) => project(index + 1));
const ids = (list: PublicProject[]): number[] => list.map((entry) => entry.id);

async function bank(ratings: Record<number, { stars: number; count: number }> = {}): Promise<ProjectsService> {
  const kv = new MemoryKV();
  await kv.set(SNAPSHOT_KEY, { projects: SIXTY, fetchedAt: new Date().toISOString() });
  const service = new ProjectsService({ kv, config, log, ratingOf: (id) => ratings[id] ?? { stars: null, count: 0 } });
  // No feed key in this config: start() only loads the snapshot.
  await service.start();
  return service;
}

test('the rotation day is the Riyadh calendar day: it turns at 21:00 UTC', () => {
  const lastSecond = Date.UTC(2026, 10, 16, 20, 59, 59);
  const midnightRiyadh = Date.UTC(2026, 10, 16, 21, 0, 0);
  assert.equal(rotationDay(midnightRiyadh), rotationDay(lastSecond) + 1);
  // The whole Riyadh day that follows is one rotation day.
  assert.equal(rotationDay(Date.UTC(2026, 10, 17, 20, 59, 59)), rotationDay(midnightRiyadh));
});

test('the sync version is moved once the order has turned since it last moved', () => {
  const beforeTurn = Date.UTC(2026, 10, 16, 20, 59, 59);
  const afterTurn = Date.UTC(2026, 10, 16, 21, 0, 30);
  assert.equal(rotationTurned(beforeTurn, afterTurn), true, 'last moved yesterday (Riyadh): move it');
  assert.equal(rotationTurned(afterTurn, Date.UTC(2026, 10, 17, 20, 0, 0)), false, 'already moved today: leave it');
  assert.equal(rotationTurned(0, afterTurn), true, 'a version that never moved counts as turned');
});

test('the day\'s hand: one order per day, another the next day, another with a salt', () => {
  const day = rotationDay(Date.UTC(2026, 10, 16, 9, 0, 0));
  const today = ids([...SIXTY].sort(dayOrder(SIXTY, day)));
  assert.deepEqual(ids([...SIXTY].reverse().sort(dayOrder(SIXTY, day))), today, 'the same day gives the same order, whatever order it starts from');
  assert.equal(new Set(today).size, 60, 'every project keeps its place in the list exactly once');
  assert.notDeepEqual(ids([...SIXTY].sort(dayOrder(SIXTY, day + 1))), today, 'the next day is dealt again');
  assert.notDeepEqual(ids([...SIXTY].sort(dayOrder(SIXTY, day, 7919))), today, 'a salt gives a different hand on the same day');
  assert.notDeepEqual(today, ids(SIXTY), 'it is a shuffle, not the stored order');
});

test('«اكتشف» follows the rotation day, says which day it dealt, and pages without a repeat', async () => {
  const service = await bank();
  const day = rotationDay();
  const first = service.list({ sort: 'discover', page: 1, limit: 20 });
  assert.equal(first.day, day, 'no day named: today\'s order, and the answer says so');
  assert.deepEqual(ids(first.items), ids([...SIXTY].sort(dayOrder(SIXTY, day)).slice(0, 20)));

  // The member scrolls while the day turns: the later pages name the day of the first one.
  const yesterday = day - 1;
  const pages = [1, 2, 3].map((page) => service.list({ sort: 'discover', page, limit: 20, day: yesterday }));
  assert.ok(pages.every((page) => page.day === yesterday));
  const seen = pages.flatMap((page) => ids(page.items));
  assert.equal(seen.length, 60);
  assert.equal(new Set(seen).size, 60, 'no project comes twice');
  assert.notDeepEqual(ids(pages[0]?.items ?? []), ids(first.items), 'yesterday opened on other cards');
});

test('the adviser\'s daily tip reads one order for the whole Riyadh day', async () => {
  const service = await bank();
  // What companion/service.ts asks: the first 12 of «اكتشف» under the day of `now`.
  const pick = (now: number) => ids(service.list({ sort: 'discover', page: 1, limit: 12, day: rotationDay(now) }).items);
  const morning = Date.UTC(2026, 10, 16, 21, 10, 0); // 00:10 Riyadh
  const night = Date.UTC(2026, 10, 17, 20, 50, 0); // 23:50 Riyadh, the same day
  assert.deepEqual(pick(night), pick(morning));
  assert.notDeepEqual(pick(night + 20 * 60_000), pick(night), 'ten minutes past midnight Riyadh it is the next day\'s order');
});

test('«الأعلى تقييمًا»: the rated projects lead; the unrated tail is dealt daily, with its own hand', async () => {
  const service = await bank({ 7: { stars: 5, count: 2 }, 9: { stars: 5, count: 1 }, 30: { stars: 4, count: 3 } });
  const day = rotationDay();
  const order = (onDay: number) => ids(service.list({ sort: 'top', page: 1, limit: 50, day: onDay }).items).concat(ids(service.list({ sort: 'top', page: 2, limit: 50, day: onDay }).items));
  const today = order(day);
  assert.deepEqual(today.slice(0, 3), [7, 9, 30], 'stars first, then how many rated');
  assert.equal(new Set(today).size, 60);
  const tail = today.slice(3);
  const latestTail = ids(SIXTY).reverse().filter((id) => ![7, 9, 30].includes(id));
  assert.notDeepEqual(tail, latestTail, 'the tail no longer stands in the last-edit order');
  const tomorrow = order(day + 1);
  assert.deepEqual(tomorrow.slice(0, 3), [7, 9, 30], 'the rated projects keep their places');
  assert.notDeepEqual(tomorrow.slice(3), tail, 'the tail changes with the day');
  const discoverTail = ids(service.list({ sort: 'discover', page: 1, limit: 50, day }).items)
    .concat(ids(service.list({ sort: 'discover', page: 2, limit: 50, day }).items))
    .filter((id) => ![7, 9, 30].includes(id));
  assert.notDeepEqual(tail, discoverTail, '«اكتشف» and «الأعلى تقييمًا» do not show the same order on one day');
});

test('the orders that do not rotate stay as they were', async () => {
  const service = await bank();
  const latest = service.list({ sort: 'latest', page: 1, limit: 50 });
  assert.deepEqual(ids(latest.items).slice(0, 3), [60, 59, 58]);
  assert.deepEqual(ids(service.list({ sort: 'latest', page: 1, limit: 50, day: rotationDay() - 1 }).items), ids(latest.items));
  assert.equal(service.filters().sorts[0]?.key, 'discover', '«اكتشف» is the first chip the server offers');
});
