import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { PlayDay, PlayStoreClient } from './downloads/playStore.js';
import { DAILY_KEY, DownloadsService, type DailyDoc } from './downloads/service.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse, HubResults } from './hub/types.js';
import { PushService } from './push/service.js';
import { riyadhDay } from './riyadh.js';
import { MemoryKV } from './store.js';

// M230: the dashboard home's first card is read by partners, so every number on it has to stay true.
// - «آخر الأعضاء المسجّلين» asks `sort=newest` (M229) and the server then reads the hub's whole list page by page while
//   the hub orders it by activity: an account that becomes active between two pages lands on the next page too.
// - «منذ الإطلاق» is the sum of the stored days: Google's late first report must still bring the launch days, and the
//   400-day prune must never drop a store number.

/** The seeded mock hub, serving `admin_accounts` as two pages whose second starts with the last row of the first. */
class OverlappingHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly inner = new MockHubClient({ seed: true });
  readonly pages: number[] = [];
  /** How many accounts the hub really holds. */
  size = 0;

  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    if (op !== 'admin_accounts') return this.inner.call(op, body);
    const page = Number(body.page ?? 1);
    this.pages.push(page);
    const whole = (await this.inner.call(op, { ...body, page: 1, per_page: 100 })) as unknown as HubResults['admin_accounts'];
    this.size = whole.items.length;
    const half = Math.ceil(whole.items.length / 2);
    const items = page === 1 ? whole.items.slice(0, half) : page === 2 ? whole.items.slice(half - 1) : [];
    // A total above one page makes the sweep ask for the second one.
    return { ...whole, page, items, total: 101 } as unknown as HubResponse;
  }
}

const hub = new OverlappingHub();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let adminToken = '';

const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, payload });

before(async () => {
  app = (await buildApp({ config, kv: new MemoryKV(), hub })).app;
  const registered = await post('/api/auth/register', { name: 'سلمان العتيبي', country: 'sa', phone: '0558323001', email: 'm230.admin@gmail.com', password: 'secret123', persona: 'neutral', bio: 'حساب لاختبار ترتيب آخر المسجّلين.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  adminToken = verified.json().token as string;
});

after(async () => {
  await app.close();
});

test('the newest sweep lists every account once when the hub pages overlap', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/accounts?sort=newest&per_page=100', headers: { authorization: `Bearer ${adminToken}` } });
  assert.equal(res.statusCode, 200, res.body);
  const list = res.json() as { total: number; items: { id: number; created_at: string }[] };
  assert.deepEqual(hub.pages, [1, 2], 'the sweep read both pages');
  const ids = list.items.map((item) => item.id);
  assert.ok(ids.length > 2, 'the demo club has accounts');
  assert.equal(new Set(ids).size, ids.length, 'no account is listed twice');
  assert.equal(list.total, ids.length, 'the total counts accounts, not rows read');
  assert.equal(list.total, hub.size, 'every account of the hub is there, once');
  const sorted = [...list.items].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  assert.deepEqual(ids, sorted.map((item) => item.id), 'newest sign-up first');
});

test('Google’s first report, read long after the launch, still brings the launch days; unwritten days stay null', async () => {
  const local = new MemoryKV();
  const now = Date.now();
  const day = (offset: number) => riyadhDay(now - offset * 86_400_000);
  const monthOf = (value: string) => value.slice(0, 7).replace('-', '');
  // The first Play install was 40 days ago; Google publishes with a three-day delay and has written nothing until now.
  let total = 0;
  const rows: PlayDay[] = [];
  for (let offset = 40; offset >= 3; offset -= 1) rows.push({ day: day(offset), installs: 5, total: (total += 5) });
  const asked: string[] = [];
  const google = {
    month: async (yyyymm: string) => {
      asked.push(yyyymm);
      const found = rows.filter((row) => monthOf(row.day) === yyyymm);
      return found.length ? found : null;
    },
    list: async () => [],
  } as unknown as PlayStoreClient;
  const push = new PushService({ kv: local, log: app.log });
  const service = new DownloadsService({ kv: local, push, log: app.log, google });

  await service.snapshot(now);
  assert.ok(asked.includes(monthOf(day(40))), 'the month of the launch is asked although it is outside the 30-day window');
  const answer = await service.read(now, 90);
  const play = answer.stores.google;
  assert.deepEqual([play.allTime, play.installs, play.since, play.latest], [190, 190, day(40), day(3)], 'every day since the launch is stored');
  assert.equal(play.error, undefined);
  const at = (offset: number) => answer.series.find((point) => point.day === day(offset))!.android;
  assert.deepEqual([at(41), at(40), at(3), at(2), at(0)], [null, 5, 5, null, null], 'a day Google has no number for is null, never a zero');

  // Once a Google day is stored, only the months of the last 30 days are asked again.
  asked.length = 0;
  await service.snapshot(now);
  const recent = new Set(Array.from({ length: 31 }, (_, offset) => monthOf(day(offset))));
  assert.ok(asked.length > 0 && asked.every((month) => recent.has(month)), `asked ${asked.join(', ')}`);
  assert.equal((await service.read(now, 90)).stores.google.allTime, 190);
});

test('the 400-day prune drops old device snapshots but never a store number', async () => {
  const local = new MemoryKV();
  const now = Date.now();
  const day = (offset: number) => riyadhDay(now - offset * 86_400_000);
  await local.set(DAILY_KEY, {
    [day(500)]: { android: 1, ios: 1, storeIos: 5 },
    [day(450)]: { android: 2, ios: 2 },
    [day(2)]: { android: 3, ios: 3, storeIos: 2 },
  } satisfies DailyDoc);
  const push = new PushService({ kv: local, log: app.log });
  const service = new DownloadsService({ kv: local, push, log: app.log });
  await service.snapshot(now);
  const doc = (await local.get<DailyDoc>(DAILY_KEY)) ?? {};
  assert.equal(doc[day(500)]?.storeIos, 5, 'a day with a store number stays');
  assert.equal(doc[day(450)], undefined, 'a day with device counts only leaves');
  const apple = (await service.read(now, 30)).stores.apple;
  assert.deepEqual([apple.allTime, apple.since, apple.latest], [7, day(500), day(2)], '«منذ الإطلاق» keeps its first days');
});
