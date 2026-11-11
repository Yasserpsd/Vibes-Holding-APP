import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { type AppStoreClient, appStoreToken, parseSalesReport } from './downloads/appStore.js';
import { bucketName, parseInstallsCsv, playAssertion, type PlayStoreClient } from './downloads/playStore.js';
import { DAILY_KEY, DownloadsService, type DailyDoc } from './downloads/service.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { PushService } from './push/service.js';
import { riyadhDay } from './riyadh.js';
import { MemoryKV } from './store.js';

// M158: the dashboard's downloads card — devices per platform from the push tokens today, a daily kv
// snapshot behind the 30-day trend, and the store clients prepared behind env variables.

const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com', PUBLIC_URL: 'https://api.test' });
const kv = new MemoryKV();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
let memberToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const post = (url: string, payload: Record<string, unknown> | undefined, token?: string) => app.inject({ method: 'POST', url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string): Promise<string> {
  const registered = await post('/api/auth/register', {
    name: 'خالد الشمري',
    country: 'sa',
    phone,
    email,
    password: 'secret123',
    persona: 'investor',
    jobTitle: 'مدير استثمار',
    bio: 'حساب اختبار عدّاد التحميلات.',
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return verified.json().token as string;
}

before(async () => {
  built = await buildApp({ config, kv, hub: new MockHubClient(), mailer: new LogMailer() });
  app = built.app;
  adminToken = await signUp('m158.admin@gmail.com', '0558618821');
  memberToken = await signUp('m158.member@gmail.com', '0558618822');
  // Two phones for the admin, one for the member: 2 Android devices, 1 iPhone, 2 accounts.
  for (const [token, device] of [
    [adminToken, { token: 'ExponentPushToken[m158-android-1]', platform: 'android' }],
    [adminToken, { token: 'ExponentPushToken[m158-ios-1]', platform: 'ios' }],
    [memberToken, { token: 'ExponentPushToken[m158-android-2]', platform: 'android' }],
  ] as const) {
    const saved = await post('/api/push/tokens', device, token);
    assert.equal(saved.statusCode, 200, saved.body);
  }
});

after(async () => {
  await app.close();
});

test('the downloads endpoint needs a dashboard session', async () => {
  // The mock hub makes every verified account an admin, so only the no-session case is checkable here.
  assert.equal((await get('/api/admin/downloads')).statusCode, 401);
});

test('without store keys the card has no store number at all: devices stay a separate unit (M228)', async () => {
  const response = await get('/api/admin/downloads', adminToken);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  const body = response.json();
  assert.equal(body.range, 30);
  assert.deepEqual(body.installs, { total: null, allTime: null, complete: false });
  assert.deepEqual({ android: body.devices.android, ios: body.devices.ios, total: body.devices.total }, { android: 2, ios: 1, total: 3 });
  assert.deepEqual(body.devices.accounts, { android: 2, ios: 1, total: 2 });
  assert.deepEqual(body.stores.apple, { configured: false, installs: null, allTime: null, since: null, latest: null });
  assert.deepEqual(body.stores.google, { configured: false, installs: null, allTime: null, since: null, latest: null });
  assert.equal(body.series.length, 30);
  assert.deepEqual(body.series[29], { day: riyadhDay(Date.now()), android: null, ios: null });
  // The range chips: 7 and 90 are honoured, anything else falls back to 30.
  assert.equal((await get('/api/admin/downloads?days=7', adminToken)).json().series.length, 7);
  assert.equal((await get('/api/admin/downloads?days=90', adminToken)).json().range, 90);
  assert.equal((await get('/api/admin/downloads?days=5000', adminToken)).json().range, 30);
});

test('the snapshot job writes one row per Riyadh day and keeps the trend accumulating', async () => {
  const snapped = await post('/api/admin/downloads/snapshot', undefined, adminToken);
  assert.equal(snapped.statusCode, 200, snapped.body);
  const doc = (await kv.get<DailyDoc>(DAILY_KEY)) ?? {};
  const today = riyadhDay(Date.now());
  assert.deepEqual(doc[today], { android: 2, ios: 1 });
  assert.equal(snapped.json().snapshotAt, today);
  // A second snapshot the same day replaces the row instead of adding one.
  await post('/api/admin/downloads/snapshot', undefined, adminToken);
  assert.equal(Object.keys((await kv.get<DailyDoc>(DAILY_KEY)) ?? {}).length, 1);
});

test('store downloads follow the range, with the all-time number beside it (M228)', async () => {
  const local = new MemoryKV();
  const now = Date.now();
  const day = (offset: number) => riyadhDay(now - offset * 86_400_000);
  const doc: DailyDoc = {
    [day(40)]: { android: 0, ios: 0, storeIos: 0 },
    [day(20)]: { android: 1, ios: 1, storeIos: 5, storeAndroid: 2, playTotal: 100 },
    [day(3)]: { android: 1, ios: 1, storeIos: 4, storeAndroid: 7, playTotal: 120 },
    [day(2)]: { android: 1, ios: 1, storeIos: 6, storeAndroid: 9, playTotal: 129 },
    [day(1)]: { android: 1, ios: 1 },
  };
  await local.set(DAILY_KEY, doc);
  const push = new PushService({ kv: local, log: app.log });
  const service = new DownloadsService({ kv: local, push, log: app.log });
  const month = await service.read(now, 30);
  assert.deepEqual([month.stores.apple.installs, month.stores.apple.allTime], [15, 15]);
  assert.deepEqual([month.stores.google.installs, month.stores.google.allTime], [18, 129], 'the lifetime total of Google beats the stored days');
  assert.deepEqual(month.installs, { total: 33, allTime: 144, complete: true });
  assert.equal(month.stores.apple.since, day(20), 'since = the first day with a download, not the first stored day');
  assert.equal(month.stores.apple.latest, day(2));
  const week = await service.read(now, 7);
  assert.deepEqual([week.stores.apple.installs, week.stores.google.installs, week.installs.total], [10, 16, 26]);
  assert.equal(week.series.length, 7);
  // The trend is the downloads per day; a day a store has not written counts 0.
  const at = (offset: number) => week.series.find((point) => point.day === day(offset))!;
  assert.deepEqual([at(3), at(2), at(1)].map((point) => [point.android, point.ios]), [[7, 4], [9, 6], [0, 0]]);
});

test('a store that has not answered stays null with its reason: no device count in its place, no mixed total (M228)', async () => {
  const local = new MemoryKV();
  const now = Date.now();
  const day = (offset: number) => riyadhDay(now - offset * 86_400_000);
  await local.set(DAILY_KEY, { [day(2)]: { android: 1, ios: 1, storeIos: 6 } } satisfies DailyDoc);
  const push = new PushService({ kv: local, log: app.log });
  let listed = 0;
  const google = { month: async () => null, list: async () => { listed += 1; return ['stats/installs/installs_other.app_202611_overview.csv']; } } as unknown as PlayStoreClient;
  const service = new DownloadsService({ kv: local, push, log: app.log, google });
  await service.snapshot(now);
  const answer = await service.read(now);
  assert.equal(listed, 1);
  assert.equal(answer.stores.google.installs, null);
  assert.match(answer.stores.google.error ?? '', /no installs report .* holds 1 files: installs_other\.app_202611_overview\.csv/);
  assert.equal(answer.stores.apple.installs, 6);
  assert.deepEqual(answer.installs, { total: 6, allTime: 6, complete: false });
  assert.equal(answer.series.every((point) => point.android === null), true);
  // A refused read keeps the store answer as the reason; the next good read clears it.
  const refused = { month: async () => { throw new Error('Cloud Storage answered 403 for 202611: no storage.objects.get access'); }, list: async () => [] } as unknown as PlayStoreClient;
  const second = new DownloadsService({ kv: local, push, log: app.log, google: refused });
  await second.snapshot(now);
  assert.match((await second.read(now)).stores.google.error ?? '', /answered 403/);
});

test('Apple’s «no sales» 404 settles older days as 0 and leaves yesterday to be asked again', async () => {
  const local = new MemoryKV();
  const now = Date.now();
  const day = (offset: number) => riyadhDay(now - offset * 86_400_000);
  const asked: string[] = [];
  const apple = { installsOn: async (d: string) => { asked.push(d); return d === day(3) ? 3 : null; } } as unknown as AppStoreClient;
  const push = new PushService({ kv: local, log: app.log });
  const service = new DownloadsService({ kv: local, push, log: app.log, apple });
  await service.snapshot(now);
  const doc = (await local.get<DailyDoc>(DAILY_KEY)) ?? {};
  assert.equal(doc[day(3)]?.storeIos, 3);
  assert.equal(doc[day(2)]?.storeIos, 0, 'two days old without a report = no downloads');
  assert.equal(doc[day(1)]?.storeIos, undefined, 'yesterday’s report may still be on its way');
  assert.equal(asked.length, 30);
  asked.length = 0;
  await service.snapshot(now);
  assert.deepEqual(asked, [day(1)], 'settled days are never asked again');
  assert.equal(bucketName('gs://pubsite_prod_rev_01234567890987654321/stats/installs/'), 'pubsite_prod_rev_01234567890987654321');
  assert.equal(bucketName(' pubsite_prod_rev_1 '), 'pubsite_prod_rev_1');
});

test('the App Store Connect JWT is a signed ES256 token and the sales report parser counts first downloads only', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const token = appStoreToken({ issuerId: '57246542-96fe-1a63-e053-0824d011072a', keyId: '2X9R4HXF34', privateKey: pem, vendorNumber: '85442109' }, 1_700_000_000_000);
  const [header, payload, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header!, 'base64url').toString()), { alg: 'ES256', kid: '2X9R4HXF34', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
  assert.equal(claims.aud, 'appstoreconnect-v1');
  assert.equal(claims.exp - claims.iat, 900);
  assert.equal(Buffer.from(signature!, 'base64url').length, 64, 'raw r||s signature');
  const tsv = [
    'Provider\tProvider Country\tSKU\tDeveloper\tTitle\tVersion\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tBegin Date\tEnd Date\tCustomer Currency\tCountry Code\tCurrency of Proceeds\tApple Identifier',
    'APPLE\tUS\tclub\tVibes\tInvestors Club\t1.2.0\t1F\t5\t0\t10/28/2026\t10/28/2026\tSAR\tSA\tSAR\t6752000001',
    'APPLE\tUS\tclub\tVibes\tInvestors Club\t1.2.0\t7F\t3\t0\t10/28/2026\t10/28/2026\tSAR\tSA\tSAR\t6752000001',
    'APPLE\tUS\tother\tVibes\tOther App\t1.0\t1F\t2\t0\t10/28/2026\t10/28/2026\tSAR\tSA\tSAR\t6752000002',
  ].join('\n');
  assert.equal(parseSalesReport(tsv), 7, 'updates (7F) never count');
  assert.equal(parseSalesReport(tsv, '6752000001'), 5, 'filtered to one Apple ID');
});

test('the Google assertion is RS256 for the storage read-only scope and the installs CSV yields a row per day', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const assertion = playAssertion({ client_email: 'club-stats@vibes-holding.iam.gserviceaccount.com', private_key: pem }, 1_700_000_000_000);
  const [header, payload] = assertion.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header!, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/devstorage.read_only');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  const csv = [
    'Date,Package Name,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs,Install events,Update events,Uninstall events',
    '2026-10-27,com.vcmem.investorsclub,8,1,0,118,7,1,96,8,0,1',
    '2026-10-28,com.vcmem.investorsclub,12,0,2,129,11,0,107,12,2,0',
  ].join('\r\n');
  assert.deepEqual(parseInstallsCsv(`﻿${csv}`), [
    { day: '2026-10-27', installs: 7, total: 118 },
    { day: '2026-10-28', installs: 11, total: 129 },
  ]);
});
