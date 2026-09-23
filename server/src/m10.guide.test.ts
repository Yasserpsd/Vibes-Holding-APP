import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { GUIDE_CONTENT_KEY, GUIDE_SEED } from './content/guide.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M10 «دليل المحايد»: the guide block (steps, benefits, workshops) in both languages, the neutral
// portal leading to it, and the workshop interest registrations of every signed-in account.
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
const mailer = new LogMailer();
const kv = new MemoryKV();
let built: BuiltApp;
let app: BuiltApp['app'];
let neutralToken = '';
let neutralId = 0;
let adminToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'محايد الدليل', country: 'sa', phone, email, password: 'secret123', persona: 'neutral', bio: 'حساب اختبار دليل المحايد وورش العمل.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv, hub, mailer });
  app = built.app;
  const neutral = await signUp('m10.neutral@gmail.com', '0558618831');
  neutralToken = neutral.token;
  neutralId = neutral.id;
  adminToken = (await signUp('m10.admin@gmail.com', '0558618832')).token;
  // The registering visitor is a plain account, not a club admin — and holds NO membership: the workshops are still his.
  hub.members.add(neutralId);
  await get('/api/me?fresh=1', neutralToken);
});

after(async () => {
  await app.close();
});

test('the guide block answers in both languages and the neutral portal leads to it', async () => {
  const ar = await get('/api/guide');
  assert.equal(ar.statusCode, 200);
  assert.equal(ar.json().title, 'دليل المحايد');
  assert.equal((ar.json().steps as { target: string }[]).length, 4);
  assert.equal((ar.json().workshops.items as unknown[]).length, 3);
  assert.match(ar.json().benefits[0] as string, /بدون رسوم|طوال العام/);

  const en = await get('/api/guide?lang=en');
  assert.match(en.json().title as string, /Neutral/);
  assert.equal((en.json().workshops.items as { id: string }[])[0]?.id, 'investing-basics');

  const home = await get('/api/home');
  const neutral = (home.json().portals as { key: string; target: string }[]).find((portal) => portal.key === 'neutral');
  assert.equal(neutral?.target, 'guide');
});

test('a signed-in account (no membership needed) registers once per workshop, and the management is mailed', async () => {
  assert.equal((await send('POST', '/api/workshops/register', { workshopId: 'investing-basics' })).statusCode, 401);

  const before = mailer.sent.length;
  const registered = await send('POST', '/api/workshops/register', { workshopId: 'investing-basics', note: 'أفضل الحضور أونلاين.' }, neutralToken);
  assert.equal(registered.statusCode, 201, registered.body);
  assert.equal(registered.json().registration.workshopId, 'investing-basics');
  assert.equal(mailer.sent.length, before + 1);
  assert.match(mailer.sent.at(-1)?.subject ?? '', /تسجيل في ورشة/);
  assert.match(mailer.sent.at(-1)?.text ?? '', /أفضل الحضور أونلاين/);

  const again = await send('POST', '/api/workshops/register', { workshopId: 'investing-basics' }, neutralToken);
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'already_registered');

  assert.equal((await send('POST', '/api/workshops/register', { workshopId: 'no-such' }, neutralToken)).statusCode, 404);

  const mine = await get('/api/workshops/mine', neutralToken);
  assert.equal((mine.json().registrations as { workshopId: string }[])[0]?.workshopId, 'investing-basics');
});

test('a closed workshop refuses new registrations', async () => {
  const closed = structuredClone(GUIDE_SEED);
  const first = closed.workshops.items.find((item) => item.id === 'club-meetup');
  assert.ok(first);
  first.open = false;
  await kv.set(GUIDE_CONTENT_KEY, closed);
  const refused = await send('POST', '/api/workshops/register', { workshopId: 'club-meetup' }, neutralToken);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().error.code, 'closed');
  await kv.set(GUIDE_CONTENT_KEY, GUIDE_SEED);
});

test('the dashboard lists the registrations; a plain member is refused', async () => {
  assert.equal((await get('/api/admin/workshops', neutralToken)).statusCode, 403);
  const listed = await get('/api/admin/workshops', adminToken);
  assert.equal(listed.statusCode, 200, listed.body);
  const rows = listed.json().registrations as { contactId: number; workshopTitle: string; personaLabel: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.contactId, neutralId);
  assert.match(rows[0]?.workshopTitle ?? '', /أساسيات الاستثمار/);
});
