import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { firstName } from './companion/tips.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { MemoryKV } from './store.js';

// M232 «أدوات التواصل»: a management message greets its reader by name, a popup opens from the dashboard, and an
// honorary member is kept apart from all of it — feed, popups and broadcasts.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });

type PushMessage = { to: string; title: string; body: string; data: Record<string, string> };
let pushed: PushMessage[] = [];
const fetchStub: typeof fetch = async (input, init) => {
  if (String(input) !== 'https://exp.host/--/api/v2/push/send') throw new Error(`unexpected fetch: ${String(input)}`);
  const messages = JSON.parse(String(init?.body)) as PushMessage[];
  pushed.push(...messages);
  return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) }), { status: 200 });
};

let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
let member = { token: '', id: 0 };
let partner = { token: '', id: 0 };
const MEMBER_DEVICE = 'ExponentPushToken[m232member01]';
const PARTNER_DEVICE = 'ExponentPushToken[m232partner1]';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown>, token?: string) => app.inject({ method, url, payload, headers: bearer(token) });

async function signUp(name: string, email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name, country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب لاختبار أدوات التواصل.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

const publish = async (payload: Record<string, unknown>): Promise<string> => {
  const created = await send('POST', '/api/admin/posts', { status: 'published', ...payload }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  return created.json().post.id as string;
};
const feed = async (token?: string) => (await get('/api/posts?limit=50', token)).json().posts as { id: string; body: string; kind: string }[];
const popups = async (token?: string) => (await get('/api/popups', token)).json().popups as { id: string; title: string; link: { url: string } | null }[];
const honorary = (id: number, on: boolean) => send('POST', `/api/admin/accounts/${id}/honorary`, { on, note: 'شريك رسمي في عقد التأسيس', confirm: true }, adminToken);

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub: new MockHubClient(), fetchImpl: fetchStub });
  app = built.app;
  adminToken = (await signUp('ناصر العلي', 'm232.admin@gmail.com', '0558523201')).token;
  member = await signUp('عبد الله السالم', 'm232.member@gmail.com', '0558523202');
  partner = await signUp('سلطان العتيبي', 'm232.partner@gmail.com', '0558523203');
  for (const [token, device] of [[member.token, MEMBER_DEVICE], [partner.token, PARTNER_DEVICE]] as const) {
    assert.equal((await send('POST', '/api/push/tokens', { token: device, platform: 'ios' }, token)).statusCode, 200);
  }
});

after(async () => {
  await app.close();
});

test('a compound first name stays whole', () => {
  assert.equal(firstName('عبد الله السالم'), 'عبد الله');
  assert.equal(firstName('سلطان العتيبي'), 'سلطان');
  assert.equal(firstName(''), '');
});

test('a management message opens with the reader’s name, in the feed and in its notification', async () => {
  const id = await publish({ title: 'فرصة للمستثمرين', body: 'تفاصيل الفرصة.', audience: { type: 'persona', persona: 'investor' } });
  const mine = (await feed(member.token)).find((post) => post.id === id);
  assert.equal(mine?.body, 'الأستاذ/ عبد الله،\n\nتفاصيل الفرصة.');
  assert.equal((await get(`/api/posts/${id}`, partner.token)).json().post.body, 'الأستاذ/ سلطان،\n\nتفاصيل الفرصة.');

  // An event is not a letter: it carries no greeting; a guest reads a public message as written.
  const eventId = await publish({ title: 'لقاء', body: 'لقاء الأعضاء.', kind: 'event', event: { date: '2027-01-10', place: 'الرياض' } });
  const publicId = await publish({ title: 'للجميع', body: 'رسالة عامة.' });
  assert.equal((await feed(member.token)).find((post) => post.id === eventId)?.body, 'لقاء الأعضاء.');
  assert.equal((await feed()).find((post) => post.id === publicId)?.body, 'رسالة عامة.');

  pushed = [];
  assert.equal((await send('POST', `/api/admin/posts/${id}/notify`, {}, adminToken)).statusCode, 200);
  assert.equal(pushed.find((message) => message.to === MEMBER_DEVICE)?.body, 'الأستاذ/ عبد الله، تفاصيل الفرصة.');
  assert.equal(pushed.find((message) => message.to === PARTNER_DEVICE)?.body, 'الأستاذ/ سلطان، تفاصيل الفرصة.');
});

test('an honorary member is kept apart from everything the management sends, whatever his category', async () => {
  assert.equal((await honorary(partner.id, true)).statusCode, 200);
  await get('/api/me?fresh=1', partner.token);

  assert.deepEqual(await feed(partner.token), [], 'not even what is for everyone');
  const investorsId = await publish({ title: 'للمستثمرين', body: 'رسالة الفئة.', audience: { type: 'persona', persona: 'investor' } });
  assert.equal((await feed(member.token)).some((post) => post.id === investorsId), true);
  assert.equal((await get(`/api/posts/${investorsId}`, partner.token)).statusCode, 404);

  pushed = [];
  assert.equal((await send('POST', `/api/admin/posts/${investorsId}/notify`, {}, adminToken)).statusCode, 200);
  assert.deepEqual(pushed.map((message) => message.to), [MEMBER_DEVICE]);

  // Written to him alone: refused aloud, never sent into nothing.
  const direct = await send('POST', '/api/admin/posts', { status: 'published', title: 'خاص', body: 'لك.', audience: { type: 'member', contactId: partner.id, name: 'سلطان' } }, adminToken);
  assert.equal(direct.statusCode, 409, direct.body);
  assert.equal(direct.json().error.code, 'honorary');

  // Taken back: he reads and hears again.
  assert.equal((await honorary(partner.id, false)).statusCode, 200);
  await get('/api/me?fresh=1', partner.token);
  assert.equal((await feed(partner.token)).some((post) => post.id === investorsId), true);
  pushed = [];
  assert.equal((await send('POST', `/api/admin/posts/${investorsId}/notify`, {}, adminToken)).statusCode, 200);
  assert.deepEqual(new Set(pushed.map((message) => message.to)), new Set([MEMBER_DEVICE, PARTNER_DEVICE]));
});

test('a popup opens from the dashboard: outside the inbox, without a notification, until its last day', async () => {
  pushed = [];
  const id = await publish({ title: 'عرض الأسبوع', body: 'تفاصيل العرض.', kind: 'popup', links: [{ label: 'التفاصيل', url: 'https://vcmem.com/app' }], popup: { until: '2099-01-01' } });
  assert.equal((await feed(member.token)).some((post) => post.id === id), false);
  const shown = (await popups(member.token)).find((popup) => popup.id === id);
  assert.equal(shown?.title, 'عرض الأسبوع');
  assert.equal(shown?.link?.url, 'https://vcmem.com/app');
  assert.equal((await popups()).some((popup) => popup.id === id), true, 'a popup for everyone reaches a guest too');
  assert.equal((await send('POST', `/api/admin/posts/${id}/notify`, {}, adminToken)).statusCode, 409);
  assert.deepEqual(pushed, []);

  const over = await publish({ title: 'انتهى', body: '', kind: 'popup', popup: { until: '2020-01-01' } });
  assert.equal((await popups(member.token)).some((popup) => popup.id === over), false);

  assert.equal((await honorary(partner.id, true)).statusCode, 200);
  await get('/api/me?fresh=1', partner.token);
  assert.deepEqual(await popups(partner.token), []);
});
