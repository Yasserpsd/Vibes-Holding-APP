import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { AnalyticsService } from './analytics/service.js';
import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { riyadhDay } from './riyadh.js';
import { MemoryKV } from './store.js';

// M33: usage analytics (screens, visitors, counted acts) and the «القيم والأسعار» content editor.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com' });

/** The mock hub makes every verified account an admin; chosen ids become plain members here. */
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
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
let memberToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown>, token?: string) =>
  app.inject({ method, url, payload, headers: bearer(token) });

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'حساب الإحصائيات', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب اختبار قسم الإحصائيات ومحرر القيم.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer: new LogMailer() });
  app = built.app;
  adminToken = (await signUp('m33.admin@gmail.com', '0558618821')).token;
  const member = await signUp('m33+member@gmail.com', '0558618822');
  memberToken = member.token;
  hub.members.add(member.id);
  await get('/api/me?fresh=1', memberToken);
});

after(async () => {
  await app.close();
});

test('screen batches count views and unique visitors; bad names are dropped', async () => {
  const first = await send('POST', '/api/analytics/screens', { device: 'device-m33-aaaa', screens: ['(tabs)/index', 'news/[id]', '(tabs)/index'] });
  assert.equal(first.statusCode, 200, first.body);
  // The same device again, and one member: two visitors in all, and a bad name never becomes a row.
  await send('POST', '/api/analytics/screens', { device: 'device-m33-aaaa', screens: ['(tabs)/index', 'bad name!'] });
  await send('POST', '/api/analytics/screens', { device: 'device-m33-bbbb', screens: ['card'] }, memberToken);
  const answer = await get('/api/admin/analytics?days=7', adminToken);
  assert.equal(answer.statusCode, 200, answer.body);
  const { days, personas } = answer.json() as { days: { day: string; visitors: number; views: number; screens: Record<string, number> }[]; personas: { total: number } | null };
  assert.equal(days.length, 7);
  const today = days[days.length - 1]!;
  assert.equal(today.day, riyadhDay(Date.now()));
  assert.equal(today.screens['(tabs)/index'], 3);
  assert.equal(today.screens['card'], 1);
  assert.equal(today.screens['bad name!'], undefined);
  // The guest device and the signed-in member: the member counts by his account, not his device.
  assert.equal(today.visitors, 2);
  assert.equal(today.views, 5);
  assert.ok(personas && personas.total >= 1, JSON.stringify(personas));
});

test('a rejected device id never reaches the counters', async () => {
  const bad = await send('POST', '/api/analytics/screens', { device: 'x', screens: ['card'] });
  assert.equal(bad.statusCode, 400);
});

test('an advisor message counts itself through the response hook', async () => {
  const was = ((await get('/api/admin/analytics?days=7', adminToken)).json() as { days: { events: { advisorMessages: number } }[] }).days.at(-1)!.events.advisorMessages;
  const sent = await send('POST', '/api/advisor/message', { text: 'ما هي فرص الشراكة المتاحة؟' }, memberToken);
  assert.equal(sent.statusCode, 200, sent.body);
  const now = ((await get('/api/admin/analytics?days=7', adminToken)).json() as { days: { events: { advisorMessages: number } }[] }).days.at(-1)!.events.advisorMessages;
  assert.equal(now, was + 1);
});

test('the analytics answer is for admins only', async () => {
  assert.equal((await get('/api/admin/analytics', memberToken)).statusCode, 403);
  assert.equal((await get('/api/admin/analytics')).statusCode, 401);
});

test('old analytics days fall off the index with their documents', async () => {
  const kv = new MemoryKV();
  const service = new AnalyticsService({ kv, log: app.log });
  const old = Date.now() - 500 * 86_400_000;
  service.screens(['card'], 'd:old', old);
  await service.flush();
  service.screens(['card'], 'd:new');
  await service.flush();
  const index = await kv.get<{ days: string[] }>('analytics:index');
  assert.deepEqual(index?.days, [riyadhDay(Date.now())]);
  assert.equal(await kv.get(`analytics:days:${riyadhDay(old)}`), null);
});

test('«القيم والأسعار»: the list carries prices, phones, links and switches — never names or icons', async () => {
  const answer = await get('/api/admin/content/values', adminToken);
  assert.equal(answer.statusCode, 200, answer.body);
  const { items } = answer.json() as { items: { block: string; path: string; kind: string; value: unknown }[] };
  const amount = items.find((item) => item.block === 'services' && item.path === 'services.meetup.action.amount');
  assert.ok(amount && amount.kind === 'number' && amount.value === 30000, JSON.stringify(amount));
  assert.ok(items.some((item) => item.kind === 'phone' && item.path.endsWith('action.phone')));
  assert.ok(items.some((item) => item.block === 'videos' && item.kind === 'url' && item.path === 'channelUrl'));
  // Names, icons and enum fields stay out.
  assert.ok(!items.some((item) => item.path.endsWith('.key') || item.path.endsWith('.icon') || item.path.endsWith('.version')));
});

test('a price edit lands in the stored block and reaches the app', async () => {
  const saved = await send('PUT', '/api/admin/content/value', { block: 'services', path: 'services.meetup.action.memberAmount', value: 12500 }, adminToken);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().value, 12500);
  assert.ok(saved.json().edit, 'the edit records who and when');
  const services = await get('/api/services', memberToken);
  const meetup = (services.json() as { services: { key: string; price: { amount: number } | null }[] }).services.find((row) => row.key === 'meetup');
  assert.equal(meetup?.price?.amount, 12500, JSON.stringify(meetup?.price));
});

test('a wrong type, an unknown path and a non-admin are refused', async () => {
  assert.equal((await send('PUT', '/api/admin/content/value', { block: 'services', path: 'services.meetup.action.amount', value: 'كثير' }, adminToken)).statusCode, 400);
  assert.equal((await send('PUT', '/api/admin/content/value', { block: 'services', path: 'services.meetup.title', value: 5 }, adminToken)).statusCode, 400);
  assert.equal((await send('PUT', '/api/admin/content/value', { block: 'services', path: 'services.meetup.action.amount', value: 100 }, memberToken)).statusCode, 403);
});

test('«رجوع للقيمة الأصلية»: null writes the seed value back and clears the edit', async () => {
  const reset = await send('PUT', '/api/admin/content/value', { block: 'services', path: 'services.meetup.action.memberAmount', value: null }, adminToken);
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal(reset.json().value, 15000);
  assert.equal(reset.json().edit, null);
  const values = (await get('/api/admin/content/values', adminToken)).json() as { edited: number };
  assert.equal(values.edited, 0);
});
