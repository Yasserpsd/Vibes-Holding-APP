import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MOCK_CODE, MockHubClient } from '../hub/mock.js';
import { MemoryKV } from '../store.js';
import { APP_STRINGS } from './catalog.js';
import { placeholdersOf, wordingProblem } from './service.js';

/** M24 + M27: the app's wording in two languages, and the owner's edits of it from the dashboard. */

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', NEWS_REFRESH_MINUTES: '0' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let token = '';

before(async () => {
  app = (await buildApp({ config, kv, hub: new MockHubClient() })).app;
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'مدير النصوص', country: 'sa', phone: '0558318711', email: 'wording.admin@gmail.com', password: 'secret123', persona: 'neutral', bio: 'حساب لاختبار تعديل نصوص التطبيق.' } });
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  token = verified.json().token as string;
});

after(async () => {
  await app.close();
});

const put = (payload: Record<string, unknown>, auth = token) => app.inject({ method: 'PUT', url: '/api/admin/strings', payload, headers: auth ? { authorization: `Bearer ${auth}` } : {} });

test('the catalog is the app’s own wording, key for key in both languages', () => {
  const strings = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'app', 'src', 'i18n', 'strings');
  // The server is deployed from its own folder: the comparison runs wherever the whole repository is present.
  if (existsSync(strings)) {
    for (const name of ['ar', 'en', 'groups'] as const) {
      assert.deepEqual(APP_STRINGS[name], JSON.parse(readFileSync(join(strings, `${name}.json`), 'utf8')), `${name}.json changed: run "npm run strings" in server/`);
    }
  }
  assert.deepEqual(Object.keys(APP_STRINGS.en).sort(), Object.keys(APP_STRINGS.ar).sort());
  for (const key of Object.keys(APP_STRINGS.ar)) {
    assert.deepEqual(placeholdersOf(APP_STRINGS.en[key] ?? '').sort(), placeholdersOf(APP_STRINGS.ar[key] ?? '').sort(), `placeholders of ${key}`);
    assert.ok(key.split('.')[0]! in APP_STRINGS.groups, `group of ${key}`);
    assert.equal(wordingProblem('ar', key, APP_STRINGS.ar[key] ?? ''), null, `the app's own Arabic text of ${key} follows the copy rules`);
    assert.equal(wordingProblem('en', key, APP_STRINGS.en[key] ?? ''), null, `the app's own English text of ${key} follows the copy rules`);
  }
});

test('a wording is edited, never emptied, and keeps the copy rules', () => {
  assert.equal(wordingProblem('ar', 'tabs.home', 'الصفحة الرئيسية'), null);
  assert.match(wordingProblem('ar', 'tabs.home', '   ') ?? '', /فارغ/);
  assert.match(wordingProblem('ar', 'no.such.key', 'x') ?? '', /غير موجود/);
  assert.match(wordingProblem('ar', 'tabs.home', 'اشتراك مجاني') ?? '', /بدون رسوم/);
  assert.match(wordingProblem('ar', 'tabs.home', 'كريديت يومي') ?? '', /رصيد/);
  assert.match(wordingProblem('ar', 'tabs.home', 'أحدث الصفقات') ?? '', /الشراكات/);
  assert.match(wordingProblem('ar', 'tabs.home', 'من 7-8 أيام') ?? '', /شرطة/);
  assert.equal(wordingProblem('ar', 'tabs.home', 'من 7%–8%'), null, 'the en dash is the allowed range');
  assert.match(wordingProblem('en', 'tabs.home', 'Free home') ?? '', /free/);
  assert.match(wordingProblem('ar', 'account.version', 'رقم الإصدار') ?? '', /\{version\}/, 'a placeholder the app fills in stays');
  assert.equal(wordingProblem('ar', 'account.version', 'رقم الإصدار {version}'), null);
});

test('only a dashboard admin edits; the app reads the edits of its language', async () => {
  assert.equal((await put({ lang: 'ar', key: 'tabs.home', value: 'بيتي' }, '')).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/strings' })).statusCode, 401);

  const empty = await app.inject({ method: 'GET', url: '/api/strings' });
  assert.deepEqual([empty.json().lang, empty.json().version, empty.json().strings], ['ar', '0', {}]);
  assert.equal(empty.headers['cache-control'], 'no-store');

  const syncBefore = (await app.inject({ method: 'GET', url: '/api/sync' })).json().v.content as number;
  const saved = await put({ lang: 'ar', key: 'tabs.home', value: '  الصفحة الرئيسية ' });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual([saved.json().edit.value, saved.json().edit.by], ['الصفحة الرئيسية', 'مدير النصوص']);
  assert.notEqual((await app.inject({ method: 'GET', url: '/api/sync' })).json().v.content, syncBefore, 'open apps hear of the edit');

  const arabic = (await app.inject({ method: 'GET', url: '/api/strings' })).json();
  assert.deepEqual(arabic.strings, { 'tabs.home': 'الصفحة الرئيسية' });
  assert.notEqual(arabic.version, '0');
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/strings', headers: { 'x-app-lang': 'en' } })).json().strings, {}, 'the English wording is its own list');

  await put({ lang: 'en', key: 'tabs.home', value: 'Start' });
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/strings?lang=en' })).json().strings, { 'tabs.home': 'Start' });

  const refused = await put({ lang: 'ar', key: 'tabs.news', value: 'أخبار مجانية' });
  assert.equal(refused.statusCode, 400);
  assert.match(refused.json().error.message, /بدون رسوم/);

  const list = (await app.inject({ method: 'GET', url: '/api/admin/strings', headers: { authorization: `Bearer ${token}` } })).json();
  const home = list.items.find((item: { key: string }) => item.key === 'tabs.home');
  assert.deepEqual([home.ar, home.arEdit.value, home.en, home.enEdit.value, home.group], ['الرئيسية', 'الصفحة الرئيسية', 'Home', 'Start', 'tabs']);
  assert.deepEqual(list.edited, { ar: 1, en: 1 });
  assert.ok(list.groups.some((group: { key: string; label: string; count: number }) => group.key === 'tabs' && group.count === 5));

  // Back to the app's own text: by asking for it, or by typing it again.
  assert.equal((await put({ lang: 'ar', key: 'tabs.home', value: null })).json().edit, null);
  assert.equal((await put({ lang: 'en', key: 'tabs.home', value: 'Home' })).json().edit, null);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/strings' })).json().strings, {});
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/strings?lang=en' })).json().strings, {});
});
