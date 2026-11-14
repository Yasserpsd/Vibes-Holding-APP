import assert from 'node:assert/strict';
import { test } from 'node:test';

import Fastify from 'fastify';

import { appVersionEnabled, appVersionRoutes, BASELINE_FLOOR, installAppVersionGate, STORE_APP_VERSION } from './appVersion.js';
import { REACH_MIN_LAUNCHES, VersionStats } from './appVersionStats.js';
import type { AuthService } from './auth/service.js';
import { loadConfig } from './config.js';
import { MemoryKV } from './store.js';
import { parseAppStore, parsePlayStore, StoreVersions, type StorePlatform } from './storeVersions.js';

// M239 (owner, 2026-11-14): «أي حد عنده نسخة قبل 1.3.0 لازم يعمل ابديت… مع كل build نلغي اللي قبله… واتأكد إنها
// تطلع في النسخة القديمة فقط، ميبقاش حد عنده نسخة جديدة ويطلعه ايرور».

const HOUR = 3_600_000;
const T0 = Date.parse('2026-11-14T18:00:00Z');
const log = { warn: () => undefined, info: () => undefined } as never;
const IOS_UA = (build: number) => `InvestorsClub/${build} CFNetwork/1568.200.51 Darwin/24.1.0`;

type Shelf = { version: string; minOs?: string | null } | null;
/** A stand-in for the two stores: what each one shows right now (null = the lookup fails). */
function fakeStores(live: { ios: Shelf; android: Shelf }) {
  return (async (input: unknown) => {
    const ios = String(input).includes('itunes.apple.com');
    const shelf = ios ? live.ios : live.android;
    if (!shelf) return new Response('down', { status: 503 });
    if (ios) return new Response(JSON.stringify({ resultCount: 1, results: [{ version: shelf.version, minimumOsVersion: shelf.minOs === undefined ? '16.4' : shelf.minOs }] }), { status: 200 });
    const minSdk = shelf.minOs === undefined ? '24' : shelf.minOs;
    return new Response(`<html>…"140":[[["9.9.9"]]],"141":[[["${shelf.version}"]],[[[36]]${minSdk ? `,[[[${minSdk},"7.0"]]]` : ''}]],"146"…</html>`, { status: 200 });
  }) as typeof fetch;
}

function watch(kv: MemoryKV, live: { ios: Shelf; android: Shelf }, reached: Partial<Record<StorePlatform, boolean>> = { ios: true, android: true }) {
  return new StoreVersions({
    kv,
    log,
    appId: 'com.vcmem.investorsclub',
    graceHours: 24,
    baseline: BASELINE_FLOOR,
    known: STORE_APP_VERSION,
    knownMinOs: { ios: '16.4', android: '24' },
    reach: async (platform) => reached[platform] === true,
    fetchImpl: fakeStores(live),
  });
}

async function server(options: { kv?: MemoryKV; stores?: StoreVersions } = {}) {
  const kv = options.kv ?? new MemoryKV();
  const gate = { kv, enabled: true, stores: options.stores };
  const app = Fastify();
  installAppVersionGate(app, gate);
  await app.register(appVersionRoutes, { ...gate, auth: {} as AuthService });
  app.get('/api/ping', async () => ({ ok: true }));
  const ping = async (headers: Record<string, string>, query = '') => (await app.inject({ method: 'GET', url: `/api/ping${query}`, headers })).statusCode;
  const status = async (headers: Record<string, string>, query = '') => (await app.inject({ method: 'GET', url: `/api/app/status${query}`, headers })).json() as { updateRequired: boolean; minVersion: string };
  return { app, kv, ping, status };
}

const iphone = (binary: string) => ({ 'x-app-platform': 'ios', 'x-app-binary': binary, 'x-app-version': binary });
const android = (binary: string) => ({ 'x-app-platform': 'android', 'x-app-binary': binary, 'x-app-version': binary });

test('M239: a binary proven older than 1.3.0 is stopped — by its own version, by the iPhone build number, or by an old bundle', async () => {
  const { app, ping, status } = await server();
  assert.equal(BASELINE_FLOOR, '1.3.0');

  // The new bundle names the installed binary: an OTA on a 1.2.0 phone reports bundle 1.3.3 but binary 1.2.0.
  assert.equal(await ping({ 'x-app-platform': 'android', 'x-app-version': '1.3.3', 'x-app-binary': '1.2.0' }), 426);
  assert.equal(await ping({ 'x-app-platform': 'ios', 'x-app-version': '1.3.3', 'x-app-binary': '1.2.0' }), 426);
  assert.equal((await status({ 'x-app-platform': 'android', 'x-app-version': '1.3.3', 'x-app-binary': '1.2.0' })).updateRequired, true);
  assert.equal((await status({ 'x-app-platform': 'android' }, '?version=1.3.3&binary=1.1.0')).updateRequired, true);

  // An iPhone bundle too old to send anything still carries its store build number: 1.1.0 = builds 2–3, 1.2.0 = 4.
  assert.equal(await ping({ 'x-app-platform': 'ios', 'user-agent': IOS_UA(3) }), 426);
  assert.equal(await ping({ 'x-app-platform': 'ios', 'user-agent': IOS_UA(4) }), 426);
  // …even the first 1.1.0 bundles, which did not name their platform yet.
  assert.equal(await ping({ 'user-agent': IOS_UA(2) }), 426);
  // What an iPhone on 1.2.0 sends today, before the new bundle reaches it: bundle 1.3.2 everywhere, build 4.
  assert.equal(await ping({ 'x-app-platform': 'ios', 'x-app-version': '1.3.2', 'user-agent': IOS_UA(4) }), 426);
  assert.equal((await status({ 'x-app-platform': 'ios', 'x-app-version': '1.3.2', 'user-agent': IOS_UA(4) }, '?version=1.3.2')).updateRequired, true);

  // A bundle is never older than its binary: bundle 1.2.0 proves a binary of 1.2.0 at most.
  assert.equal(await ping({ 'x-app-platform': 'android', 'x-app-version': '1.2.0' }), 426);
  assert.equal((await status({ 'x-app-platform': 'ios' }, '?version=1.2.0')).updateRequired, true);
  await app.close();
});

test('M239: nobody on 1.3.0 or newer is ever stopped, and a phone that proves nothing is never judged', async () => {
  const { app, ping, status } = await server();

  for (const platform of ['ios', 'android']) {
    for (const binary of ['1.3.0', '1.3.1', '1.3.2', '1.3.3', '1.4.0', '2.0.0']) {
      assert.equal(await ping({ 'x-app-platform': platform, 'x-app-version': binary, 'x-app-binary': binary }), 200, `${platform} ${binary}`);
      assert.equal((await status({ 'x-app-platform': platform, 'x-app-version': binary, 'x-app-binary': binary })).updateRequired, false, `${platform} ${binary}`);
      // The bundle version alone (M195 bundles before this change).
      assert.equal(await ping({ 'x-app-platform': platform, 'x-app-version': binary }), 200, `${platform} bundle ${binary}`);
      assert.equal((await status({ 'x-app-platform': platform }, `?version=${binary}`)).updateRequired, false);
    }
  }

  // The M200 damage, never again: the store build of 1.3.0 for Android was cut before the app sent any version,
  // so a fresh install (or a phone whose OTA never applied) sends the platform and nothing else.
  assert.equal(await ping({ 'x-app-platform': 'android' }), 200);
  assert.equal(await ping({ 'x-app-platform': 'android', 'user-agent': 'okhttp/4.12.0' }), 200);
  assert.equal((await status({ 'x-app-platform': 'android' })).updateRequired, false);
  // The same on an iPhone of a current build: 1.3.0 = builds 5–8, 1.3.2 = 11, and builds the table does not know.
  for (const build of [5, 8, 9, 11, 12, 40]) {
    assert.equal(await ping({ 'x-app-platform': 'ios', 'user-agent': IOS_UA(build) }), 200, `build ${build}`);
    assert.equal(await ping({ 'user-agent': IOS_UA(build) }), 200, `build ${build}, no platform`);
  }
  // A user agent of another shape proves nothing (a dotted version is not a build number).
  assert.equal(await ping({ 'x-app-platform': 'ios', 'user-agent': 'InvestorsClub/1.2.0 CFNetwork/1568 Darwin/24' }), 200);
  assert.equal(await ping({ 'x-app-platform': 'ios', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' }), 200);
  // The native version wins over everything else: a current binary is never judged by an older signal.
  assert.equal(await ping({ 'x-app-platform': 'ios', 'x-app-binary': '1.3.2', 'x-app-version': '1.2.0', 'user-agent': IOS_UA(3) }), 200);
  // Not proof: garbage, the client's «unknown» 0.0.0, a bare number, and a query on any path but the status.
  assert.equal(await ping({ 'x-app-platform': 'android', 'x-app-binary': 'exposdk:57.0.0', 'x-app-version': 'abc' }), 200);
  assert.equal(await ping({ 'x-app-platform': 'android', 'x-app-version': '0.0.0' }), 200);
  assert.equal(await ping({ 'x-app-platform': 'android', 'x-app-version': '1' }), 200);
  assert.equal(await ping({ 'x-app-platform': 'android' }, '?version=1.0.0&binary=1.0.0'), 200);
  assert.equal((await status({ 'x-app-platform': 'android' }, '?version=0.0.0')).updateRequired, false);
  // The dashboard and plain probes (no platform header) are never judged, whatever they carry.
  assert.equal(await ping({ 'x-app-version': '0.1.0', 'x-app-binary': '0.1.0' }), 200);
  assert.equal((await status({}, '?version=1.0.0')).updateRequired, false);
  await app.close();

  // A floor that cannot be read stops nobody.
  const broken = new MemoryKV();
  broken.get = (async () => {
    throw new Error('database down');
  }) as never;
  const blind = await server({ kv: broken });
  assert.equal(await blind.ping(android('1.0.0')), 200);
  assert.equal((await blind.status(android('1.0.0'))).updateRequired, false);
  await blind.app.close();
});

test('M239: every new store build retires the one before it — per store, only once it is really live and really on phones', async () => {
  const kv = new MemoryKV();
  const live: { ios: Shelf; android: Shelf } = { ios: { version: '1.3.2' }, android: { version: '1.3.2' } };
  const reached: Partial<Record<StorePlatform, boolean>> = {};
  const stores = watch(kv, live, reached);

  assert.deepEqual(parseAppStore({ results: [{ version: '1.3.2', minimumOsVersion: '16.4' }] }), { version: '1.3.2', minOs: '16.4' });
  assert.equal(parseAppStore({ results: [] }), null);
  assert.deepEqual(parsePlayStore('"141":[[["1.3.2"]],[[[36]],[[[24,"7.0"]]]]]'), { version: '1.3.2', minOs: '24' });
  assert.equal(parsePlayStore('"141":[[["Varies with device"]],[[[36]]'), null);
  assert.equal(parsePlayStore('"140":[[["9.9.9"]],[[[36]],[[[24,"7.0"]]]]]'), null, 'only the version key is read');

  // The server asks the stores every hour.
  const hours = async (from: number, to: number, watcher = stores) => {
    for (let hour = from; hour <= to; hour += 1) await watcher.refresh(T0 + hour * HOUR);
  };

  // The version already live when the watch begins retires nobody: the floor is the owner's baseline.
  await hours(0, 100);
  assert.equal(await stores.floor('ios', T0 + 100 * HOUR), '1.3.0');
  assert.equal(await stores.floor('android', T0 + 100 * HOUR), '1.3.0');

  // Google publishes 1.3.3. Inside the grace period nobody is asked.
  live.android = { version: '1.3.3' };
  await hours(101, 120);
  assert.equal(await stores.floor('android', T0 + 120 * HOUR), '1.3.0', 'still inside the grace period');
  // After it, the store page alone is still not enough: Android phones are not running it yet (staged rollout).
  await hours(121, 140);
  assert.equal(await stores.floor('android', T0 + 140 * HOUR), '1.3.0', 'the page runs ahead of the phones');
  assert.equal((await stores.snapshot()).android?.waiting, 'reach');
  // Once they are, Android below 1.3.3 is retired — iPhone is not: Apple has not published it.
  reached.android = true;
  reached.ios = true;
  await hours(141, 141);
  assert.equal(await stores.floor('android', T0 + 141 * HOUR), '1.3.3');
  assert.equal(await stores.floor('ios', T0 + 141 * HOUR), '1.3.0');

  // A failed lookup changes nothing.
  live.ios = null;
  await hours(142, 142);
  assert.equal(await stores.live('ios'), '1.3.2');
  assert.equal(await stores.floor('ios', T0 + 142 * HOUR), '1.3.0');

  // Apple publishes, the build is pulled an hour later and comes back: the grace period starts again.
  live.ios = { version: '1.3.3' };
  await hours(143, 143);
  live.ios = { version: '1.3.2' };
  await hours(144, 144);
  live.ios = { version: '1.3.3' };
  await hours(145, 168);
  assert.equal(await stores.floor('ios', T0 + 168 * HOUR), '1.3.0', 'a day after the first sight, but not a day without a break');
  await hours(169, 170);
  assert.equal(await stores.floor('ios', T0 + 170 * HOUR), '1.3.3');

  // A rollback in the store pulls the floor back with it; the return waits a full grace period again.
  live.android = { version: '1.3.2' };
  await hours(171, 171);
  assert.equal(await stores.floor('android', T0 + 171 * HOUR), '1.3.2');
  live.android = { version: '1.3.3' };
  await hours(172, 190);
  assert.equal(await stores.floor('android', T0 + 190 * HOUR), '1.3.2', 'back in the store for less than a day');
  await hours(191, 197);
  assert.equal(await stores.floor('android', T0 + 197 * HOUR), '1.3.3');

  // A build that asks for a newer OS never retires the older ones by itself: those phones could not update…
  live.android = { version: '1.4.0', minOs: '26' };
  // …nor one whose requirement could not be read.
  live.ios = { version: '1.4.0', minOs: null };
  await hours(198, 240);
  assert.equal(await stores.floor('android', T0 + 240 * HOUR), '1.3.3');
  assert.equal((await stores.snapshot()).android?.waiting, 'min-os');
  assert.equal(await stores.floor('ios', T0 + 240 * HOUR), '1.3.3');
  assert.equal((await stores.snapshot()).ios?.waiting, 'min-os');
  // The owner decides: a floor he types that covers the build is his yes, and the rule runs by itself again after it.
  await stores.acceptMinOs('android', '1.3.3');
  await hours(241, 241);
  assert.equal(await stores.floor('android', T0 + 241 * HOUR), '1.3.3', 'a typed floor below the build is not a yes to it');
  await stores.acceptMinOs('android', '1.4.0');
  await hours(242, 242);
  assert.equal(await stores.floor('android', T0 + 242 * HOUR), '1.4.0');

  // The state survives a restart (it lives in the kv).
  assert.equal(await watch(kv, live).floor('android', T0 + 242 * HOUR), '1.4.0');

  // Lookups that stop for a day do not count as a day live: seen again after the silence, the clock starts again.
  const quiet = new MemoryKV();
  const shelf: { ios: Shelf; android: Shelf } = { ios: { version: '1.3.2' }, android: { version: '1.3.2' } };
  const silent = watch(quiet, shelf);
  await hours(0, 2, silent);
  shelf.ios = { version: '1.3.3' };
  await hours(3, 3, silent);
  shelf.ios = null;
  await hours(4, 29, silent);
  shelf.ios = { version: '1.3.3' };
  await hours(30, 30, silent);
  assert.equal(await silent.floor('ios', T0 + 30 * HOUR), '1.3.0', 'two sightings a day apart are not a day live');
  await hours(31, 54, silent);
  assert.equal(await silent.floor('ios', T0 + 54 * HOUR), '1.3.3');
  // A store unreadable for days no longer holds a raised floor: what it offers now is unknown.
  shelf.ios = null;
  await hours(55, 60, silent);
  assert.equal(await silent.floor('ios', T0 + 60 * HOUR), '1.3.3');
  await hours(61, 130, silent);
  assert.equal(await silent.floor('ios', T0 + 130 * HOUR), '1.3.0');

  // A first sight that is already above the version this code knows is a release under way, not the start…
  const late = watch(new MemoryKV(), { ios: { version: '1.3.3' }, android: { version: '1.3.3', minOs: '26' } });
  await hours(0, 23, late);
  assert.equal(await late.floor('ios', T0 + 23 * HOUR), '1.3.0');
  await hours(24, 25, late);
  assert.equal(await late.floor('ios', T0 + 25 * HOUR), '1.3.3');
  // …and its own requirement is not the reference: the known build's is.
  assert.equal(await late.floor('android', T0 + 25 * HOUR), '1.3.0');
  assert.equal((await late.snapshot()).android?.waiting, 'min-os');
});

test('M239: the gate at a raised floor, and a floor typed by the owner can only raise it — never past what the store has settled on', async () => {
  const since = new Date(Date.now() - 72 * HOUR).toISOString();
  const state = { live: '1.3.3', since, initial: '1.3.2', settled: '1.3.3', floor: '1.3.3', liveMinOs: '24', floorMinOs: '24', waiting: null, checkedAt: since };
  const both = { ios: state, android: state };
  const shelf = { ios: { version: '1.3.3' }, android: { version: '1.3.3' } };

  const kv = new MemoryKV();
  await kv.set('app:storeVersions', both);
  // What the old gate left behind can never wake up.
  await kv.set('app:minVersion', { minVersion: '9.9.9' });
  const { app, ping, status } = await server({ kv, stores: watch(kv, shelf) });
  assert.equal(await ping(iphone('1.3.2')), 426);
  assert.equal(await ping(android('1.3.0')), 426);
  assert.equal(await ping(iphone('1.3.3')), 200);
  assert.equal(await ping(android('1.3.3')), 200);
  assert.equal(await ping(android('1.4.0')), 200);
  assert.equal(await ping({ 'x-app-platform': 'android' }), 200, 'no proof, no judgement — at any floor');
  // A bundle's own number proves nothing from 1.3.0 on: an older tree published onto the newest binary (a rollback,
  // a hot fix from an old checkout) must never lock out the people who are up to date.
  assert.equal(await ping({ 'x-app-platform': 'android', 'x-app-version': '1.3.2' }), 200);
  assert.equal(await ping({ 'x-app-platform': 'android', 'x-app-version': '1.3.0' }), 200);
  assert.equal((await status({ 'x-app-platform': 'android' }, '?version=1.3.2')).updateRequired, false);
  assert.equal(await ping({ 'x-app-platform': 'android', 'x-app-version': '1.2.0' }), 426, 'below 1.3.0 it still does');
  // The header-less iPhone path ends at build 4 and does not widen with the floor.
  assert.equal(await ping({ 'user-agent': IOS_UA(11) }), 200);
  assert.equal(await ping({ 'user-agent': IOS_UA(4) }), 426);
  // The iPhone build table ends at 1.3.2 (build 11): a higher build is a newer binary, whatever bundle it runs —
  // even one published from an older tree (a rollback), whose own number is below the floor.
  assert.equal(await ping({ 'x-app-platform': 'ios', 'user-agent': IOS_UA(12), 'x-app-version': '1.3.2' }), 200);
  assert.equal(await ping({ 'x-app-platform': 'ios', 'user-agent': IOS_UA(11), 'x-app-version': '1.3.3' }), 426, 'build 11 is 1.3.2, whatever the bundle says');
  assert.equal((await status(iphone('1.3.3'))).updateRequired, false);
  assert.equal((await status(iphone('1.3.2'))).minVersion, '1.3.3');
  await app.close();

  // Typed 9.9.9: held at the version the store has settled on.
  const high = new MemoryKV();
  await high.set('app:storeVersions', both);
  await high.set('app:floorOverride', { minVersion: '9.9.9' });
  const held = await server({ kv: high, stores: watch(high, shelf) });
  assert.equal(await held.ping(iphone('1.3.3')), 200);
  assert.equal(await held.ping(android('1.3.2')), 426);
  await held.app.close();

  // Typed below the automatic floor: it cannot lower it, and nothing opens below the baseline.
  const low = new MemoryKV();
  await low.set('app:storeVersions', both);
  await low.set('app:floorOverride', { minVersion: '1.0.0' });
  const kept = await server({ kv: low, stores: watch(low, shelf) });
  assert.equal(await kept.ping(android('1.3.2')), 426);
  await kept.app.close();

  // Typed 1.3.3 while 1.3.3 is live but still inside its grace period: the floor waits with it.
  const young = new MemoryKV();
  const fresh = { ...state, since: new Date(Date.now() - 2 * HOUR).toISOString(), settled: '1.3.2', floor: undefined, waiting: 'grace' };
  await young.set('app:storeVersions', { ios: fresh, android: fresh });
  await young.set('app:floorOverride', { minVersion: '1.3.3' });
  const waits = await server({ kv: young, stores: watch(young, shelf) });
  assert.equal(await waits.ping(iphone('1.3.2')), 200, 'the App Store may not offer 1.3.3 to this phone yet');
  assert.equal(await waits.ping(iphone('1.3.1')), 426, 'but 1.3.2 has been out long enough to be asked for');
  await waits.app.close();

  // The stores unread (tests, a first boot): a typed floor is held at the version this code knows is out.
  const blind = new MemoryKV();
  await blind.set('app:floorOverride', { minVersion: '9.9.9' });
  const capped = await server({ kv: blind });
  assert.equal(await capped.ping(android('1.3.2')), 200);
  assert.equal(await capped.ping(android('1.3.1')), 426);
  await capped.app.close();
});

test('M239: the launch counters — how far a new version has reached its phones, safely', async () => {
  const kv = new MemoryKV();
  const stats = new VersionStats(kv);
  const now = Date.now();
  const proof = (version: string) => ({ source: 'binary' as const, version });

  const at = { now };
  // Too few phones on the new version: a tester circle is not the fleet.
  for (let i = 0; i < REACH_MIN_LAUNCHES - 1; i += 1) stats.count('android', proof('1.3.3'), 'ok', at);
  assert.equal((await stats.reached('android', '1.3.3', now)).reached, false);
  // Enough of them, but a small share (a 10% staged rollout)…
  for (let i = 0; i < 400; i += 1) stats.count('android', proof('1.3.2'), 'ok', at);
  stats.count('android', proof('1.3.3'), 'ok', at);
  assert.equal((await stats.reached('android', '1.3.3', now)).reached, false);
  // …or half of them (a 50% staged rollout).
  for (let i = 0; i < 370; i += 1) stats.count('android', proof('1.3.3'), 'ok', at);
  const half = await stats.reached('android', '1.3.3', now);
  assert.equal(half.reached, false, JSON.stringify(half));
  // A clear majority of the phones that named their binary.
  for (let i = 0; i < 300; i += 1) stats.count('android', proof('1.3.3'), 'ok', at);
  const most = await stats.reached('android', '1.3.3', now);
  assert.equal(most.reached, true, JSON.stringify(most));
  // The other platform, bundles that only know their own number and blocked requests say nothing about it.
  for (let i = 0; i < 500; i += 1) stats.count('ios', { source: 'bundle', version: '1.3.3' }, 'ok', at);
  for (let i = 0; i < 500; i += 1) stats.count('ios', proof('1.3.3'), 'blocked', at);
  assert.equal((await stats.reached('ios', '1.3.3', now)).reached, false);
  // A higher number is a tester build or a made-up header: it never counts as «on it».
  for (let i = 0; i < 500; i += 1) stats.count('ios', proof('9.9.9'), 'ok', at);
  assert.equal((await stats.reached('ios', '1.3.3', now)).reached, false);
  // Launches of a week ago do not count.
  const old = new VersionStats(new MemoryKV());
  for (let i = 0; i < 100; i += 1) old.count('ios', proof('1.3.3'), 'ok', { now: now - 7 * 24 * HOUR });
  assert.equal((await old.reached('ios', '1.3.3', now)).reached, false);
  // One phone is one count a day, however often it opens the app — and a loop from one place is not a fleet.
  const loop = new VersionStats(new MemoryKV());
  for (let i = 0; i < 500; i += 1) loop.count('ios', proof('1.3.3'), 'ok', { now, who: '203.0.113.7' });
  assert.deepEqual(await loop.reached('ios', '1.3.3', now), { reached: false, launches: 1, onIt: 1 });

  // Made-up versions cannot grow the row: they are counted as «other», and the lines of a day are capped.
  const flood = new VersionStats(new MemoryKV());
  for (let i = 0; i < 2_000; i += 1) flood.count('ios', proof(`1.${i}.${i}`), 'ok', at);
  flood.count('ios', proof('99999999.1'), 'ok', at);
  const days = await flood.flush();
  const lines = Object.keys(Object.values(days)[0] ?? {});
  assert.ok(lines.length <= 301, `${lines.length} lines`);
  assert.ok(lines.includes('ios other ok'));

  // The switch: unset = on for the production app, off on the test server; 0 and 1 decide anywhere.
  assert.equal(appVersionEnabled({ APP_ENV: 'production' }), true);
  assert.equal(appVersionEnabled({ APP_ENV: 'test' }), false);
  assert.equal(appVersionEnabled({ APP_ENV: 'production', APP_VERSION_GATE: '0' }), false);
  assert.equal(appVersionEnabled({ APP_ENV: 'test', APP_VERSION_GATE: '1' }), true);
  assert.equal(loadConfig({ HUB_MODE: 'mock', APP_FLOOR_GRACE_HOURS: '' }).APP_FLOOR_GRACE_HOURS, 24);
  assert.equal(loadConfig({ HUB_MODE: 'mock', APP_FLOOR_GRACE_HOURS: '0' }).APP_FLOOR_GRACE_HOURS, 24);
  assert.equal(loadConfig({ HUB_MODE: 'mock', APP_FLOOR_GRACE_HOURS: '48' }).APP_FLOOR_GRACE_HOURS, 48);
});
