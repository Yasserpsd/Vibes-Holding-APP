import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { NEWS_SEED_VERSION, NEWS_SOURCES_KEY, NEWS_SOURCES_SEED, ensureNewsSourcesSeed, mergeSeed } from './news/sources.js';
import type { NewsSource, NewsSourcesContent } from './news/types.js';
import { MemoryKV } from './store.js';

// M34: the wider source list (seed 3) and the dashboard's on/off control over it.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com' });

class LeveledHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly members = new Set<number>();
  private readonly inner = new MockHubClient();
  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    const response = await this.inner.call(op, body);
    const contact = response.contact;
    if (contact && this.members.has(contact.id)) return { ...response, contact: { ...contact, is_admin: 0, role: 'member' } };
    return response;
  }
}

const hub = new LeveledHub();
const kv = new MemoryKV();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
let memberToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown>, token?: string) =>
  app.inject({ method, url, payload, headers: bearer(token) });

before(async () => {
  await ensureNewsSourcesSeed(kv);
  // Turning a source on fires a refresh in the background: the stubbed fetch keeps the test off the network.
  const noNetwork: typeof fetch = async () => {
    throw new Error('no network in tests');
  };
  built = await buildApp({ config, kv, hub, mailer: new LogMailer(), fetchImpl: noNetwork });
  app = built.app;
  const registered = await send('POST', '/api/auth/register', { name: 'أدمن المصادر', country: 'sa', phone: '0558618831', email: 'm34.admin@gmail.com', password: 'secret123', persona: 'investor', bio: 'حساب اختبار قسم مصادر الأخبار في اللوحة.' });
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  adminToken = verified.json().token as string;
  const registered2 = await send('POST', '/api/auth/register', { name: 'عضو المصادر', country: 'sa', phone: '0558618832', email: 'm34+member@gmail.com', password: 'secret123', persona: 'neutral', bio: 'حساب عضو عادي لاختبار صلاحيات مصادر الأخبار.' });
  const verified2 = await send('POST', '/api/auth/verify', { pendingToken: registered2.json().pendingToken, code: MOCK_CODE });
  memberToken = verified2.json().token as string;
  hub.members.add((verified2.json().me as { id: number }).id);
  await get('/api/me?fresh=1', memberToken);
});

after(async () => {
  await app.close();
});

test('the seed carries the wider lists: enabled Arabic and English sources on both sides', () => {
  const enabled = NEWS_SOURCES_SEED.filter((source) => source.enabled);
  assert.ok(enabled.filter((source) => source.lang === 'ar').length >= 20, 'twenty Arabic sources or more');
  assert.ok(enabled.filter((source) => source.lang === 'en').length >= 18, 'eighteen English sources or more');
  // Every English source reads for Saudi stories only (rule 7 + the owner's English-feed rule).
  assert.ok(NEWS_SOURCES_SEED.filter((source) => source.lang === 'en' && source.tier !== 'official').every((source) => source.saudiOnly === true));
  const ids = NEWS_SOURCES_SEED.map((source) => source.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
});

test('a stored list from seed 2 keeps the owner edits and gains the new rows', () => {
  const okaz = NEWS_SOURCES_SEED.find((source) => source.id === 'okaz-economy')!;
  const stored: NewsSourcesContent = { sources: [{ ...okaz, enabled: false }], updatedAt: '2026-09-01T00:00:00.000Z', seedVersion: 2 };
  const merged = mergeSeed(stored);
  assert.ok(merged, 'seed 3 merges');
  assert.equal(merged.seedVersion, NEWS_SEED_VERSION);
  assert.equal(merged.sources.find((source) => source.id === 'okaz-economy')?.enabled, false, 'the owner\'s off switch stays');
  assert.ok(merged.sources.some((source) => source.id === 'sabq'), 'a new Arabic row arrived');
  assert.ok(merged.sources.some((source) => source.id === 'guardian-saudi'), 'a new English row arrived');
  assert.equal(mergeSeed(merged), null, 'a second merge changes nothing');
});

test('the dashboard lists the sources with their health, admins only', async () => {
  const answer = await get('/api/admin/news/sources', adminToken);
  assert.equal(answer.statusCode, 200, answer.body);
  const body = answer.json() as { sources: (NewsSource & { tierLabel: string; status: unknown })[]; visibleByLang: { ar: number; en: number } };
  const sabq = body.sources.find((source) => source.id === 'sabq');
  assert.ok(sabq && sabq.enabled && sabq.tierLabel, JSON.stringify(sabq));
  assert.equal(body.sources.find((source) => source.id === 'arabianbusiness-saudi')?.enabled, false);
  assert.equal((await get('/api/admin/news/sources', memberToken)).statusCode, 403);
});

test('the toggle turns a source off and on, and survives in the store', async () => {
  const off = await send('POST', '/api/admin/news/sources/sabq', { enabled: false }, adminToken);
  assert.equal(off.statusCode, 200, off.body);
  assert.equal(off.json().source.enabled, false);
  const stored = await kv.get<NewsSourcesContent>(NEWS_SOURCES_KEY);
  assert.equal(stored?.sources.find((source) => source.id === 'sabq')?.enabled, false);
  const listed = await get('/api/admin/news/sources', adminToken);
  assert.equal((listed.json() as { sources: NewsSource[] }).sources.find((source) => source.id === 'sabq')?.enabled, false);
  const on = await send('POST', '/api/admin/news/sources/sabq', { enabled: true }, adminToken);
  assert.equal(on.json().source.enabled, true);
});

test('an unknown source and a bad body are refused; a member cannot toggle', async () => {
  assert.equal((await send('POST', '/api/admin/news/sources/nope', { enabled: true }, adminToken)).statusCode, 404);
  assert.equal((await send('POST', '/api/admin/news/sources/sabq', { enabled: 'yes' as unknown as boolean }, adminToken)).statusCode, 400);
  assert.equal((await send('POST', '/api/admin/news/sources/sabq', { enabled: false }, memberToken)).statusCode, 403);
});
