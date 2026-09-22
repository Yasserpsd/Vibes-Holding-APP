import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { MemoryKV } from './store.js';

// M29: targeted «رسائل الإدارة» — an audience per message, the member's inbox feed, targeted push.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });

/** Wraps the mock hub: chosen ids become moderators or plain members, and every `publish` op is recorded. */
class RecordingHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly moderators = new Set<number>();
  readonly members = new Set<number>();
  readonly published: HubBody[] = [];
  private readonly inner = new MockHubClient();
  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    if (op === 'publish') this.published.push(body);
    const response = await this.inner.call(op, body);
    const contact = response.contact;
    if (contact && this.moderators.has(contact.id)) return { ...response, contact: { ...contact, is_admin: 0, role: 'publisher' } };
    if (contact && this.members.has(contact.id)) return { ...response, contact: { ...contact, is_admin: 0, role: 'member' } };
    return response;
  }
}

type PushMessage = { to: string; title: string; body: string; data: Record<string, string> };
const pushBatches: PushMessage[][] = [];
const fetchStub: typeof fetch = async (input, init) => {
  if (String(input) !== 'https://exp.host/--/api/v2/push/send') throw new Error(`unexpected fetch: ${String(input)}`);
  const messages = JSON.parse(String(init?.body)) as PushMessage[];
  pushBatches.push(messages);
  return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) }), { status: 200 });
};

const hub = new RecordingHub();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
let modToken = '';
const users = {} as Record<'investor' | 'neutral' | 'entrepreneur', { token: string; id: number }>;

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string, persona: 'neutral' | 'entrepreneur' | 'investor'): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: `عضو ${email.split('.')[1]?.split('@')[0] ?? ''}`, country: 'sa', phone, email, password: 'secret123', persona, bio: 'حساب اختبار الرسائل الموجهة من الإدارة.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

const feedIds = async (token?: string): Promise<string[]> => {
  const feed = await get('/api/posts?limit=50', token);
  assert.equal(feed.statusCode, 200, feed.body);
  return (feed.json().posts as { id: string }[]).map((post) => post.id);
};

const publish = async (payload: Record<string, unknown>, token = adminToken): Promise<string> => {
  const created = await send('POST', '/api/admin/posts', { status: 'published', ...payload }, token);
  assert.equal(created.statusCode, 201, created.body);
  return created.json().post.id as string;
};

let allId = '';
let investorsId = '';
let neutralsId = '';
let oneMemberId = '';

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, fetchImpl: fetchStub });
  app = built.app;
  adminToken = (await signUp('m29.admin@gmail.com', '0558518801', 'neutral')).token;
  const moderator = await signUp('m29.mod@gmail.com', '0558518802', 'neutral');
  modToken = moderator.token;
  hub.moderators.add(moderator.id);
  users.investor = await signUp('m29.inv@gmail.com', '0558518803', 'investor');
  users.neutral = await signUp('m29.neu@gmail.com', '0558518804', 'neutral');
  users.entrepreneur = await signUp('m29.ent@gmail.com', '0558518805', 'entrepreneur');
  for (const key of ['investor', 'neutral', 'entrepreneur'] as const) hub.members.add(users[key].id);
  // The sign-ups were cached as admins (mock tester rule); a fresh read stores the wrapped level.
  for (const token of [modToken, users.investor.token, users.neutral.token, users.entrepreneur.token]) await get('/api/me?fresh=1', token);
});

after(async () => {
  await app.close();
});

test('each viewer reads only what is addressed to him; a guest reads the public posts alone', async () => {
  allId = await publish({ title: 'للجميع', body: 'رسالة عامة.' });
  investorsId = await publish({ title: 'للمستثمرين', body: 'رسالة فئة المستثمرين.', audience: { type: 'persona', persona: 'investor' } });
  neutralsId = await publish({ title: 'للمحايدين', body: 'رسالة فئة المحايدين.', audience: { type: 'persona', persona: 'neutral' } });
  oneMemberId = await publish({ title: 'رسالة خاصة', body: 'لك وحدك.', audience: { type: 'member', contactId: users.investor.id, name: 'عضو inv' } });

  assert.deepEqual(await feedIds(), [allId]);
  assert.deepEqual(new Set(await feedIds(users.investor.token)), new Set([allId, investorsId, oneMemberId]));
  assert.deepEqual(new Set(await feedIds(users.neutral.token)), new Set([allId, neutralsId]));
  assert.deepEqual(new Set(await feedIds(users.entrepreneur.token)), new Set([allId]));

  // The app learns only the audience kind — never the other names or ids behind a message.
  const feed = (await get('/api/posts?limit=50', users.investor.token)).json().posts as Record<string, unknown>[];
  for (const post of feed) assert.equal(typeof post.audience, 'string');
  assert.equal(feed.find((post) => post.id === oneMemberId)?.audience, 'member');
  assert.equal(feed.find((post) => post.id === investorsId)?.audience, 'persona');
  assert.equal(feed.find((post) => post.id === allId)?.audience, 'all');
});

test('a targeted post answers the wrong viewer like a missing one', async () => {
  assert.equal((await get(`/api/posts/${oneMemberId}`)).statusCode, 404);
  assert.equal((await get(`/api/posts/${oneMemberId}`, users.neutral.token)).statusCode, 404);
  assert.equal((await get(`/api/posts/${oneMemberId}`, users.investor.token)).statusCode, 200);
  assert.equal((await get(`/api/posts/${investorsId}`, users.investor.token)).statusCode, 200);
});

test('targeted posts never reach the hub, and retargeting a public post pulls it off the websites', async () => {
  const publicKeys = hub.published.filter((body) => !body.remove).map((body) => body.key);
  assert.ok(publicKeys.includes(allId));
  for (const id of [investorsId, neutralsId, oneMemberId]) assert.ok(!publicKeys.includes(id), `targeted post ${id} was handed to the hub`);

  // The public post turns targeted: the websites and the assistant must forget it.
  const edited = await send('PUT', `/api/admin/posts/${allId}`, { title: 'للجميع', body: 'رسالة عامة.', status: 'published', audience: { type: 'persona', persona: 'entrepreneur' } }, adminToken);
  assert.equal(edited.statusCode, 200, edited.body);
  assert.ok(hub.published.some((body) => body.key === allId && body.remove === true));
  assert.equal(edited.json().post.hubSync.published, false);
  assert.deepEqual(await feedIds(), []);

  // Back to everyone: it is published to the hub again.
  const back = await send('PUT', `/api/admin/posts/${allId}`, { title: 'للجميع', body: 'رسالة عامة.', status: 'published', audience: { type: 'all' } }, adminToken);
  assert.equal(back.statusCode, 200, back.body);
  assert.ok(hub.published.filter((body) => body.key === allId && !body.remove).length >= 2);
  assert.deepEqual(await feedIds(), [allId]);
});

test('a moderator publishes to everyone only and cannot touch targeted messages', async () => {
  const refused = await send('POST', '/api/admin/posts', { title: 'محاولة', body: 'رسالة موجهة من موديريتور.', status: 'published', audience: { type: 'member', contactId: users.neutral.id, name: '' } }, modToken);
  assert.equal(refused.statusCode, 403);
  assert.match(refused.json().error.message, /لحسابات الأدمن/);

  const allowed = await send('POST', '/api/admin/posts', { title: 'من الموديريتور', body: 'منشور عام.', status: 'draft' }, modToken);
  assert.equal(allowed.statusCode, 201, allowed.body);

  const edit = await send('PUT', `/api/admin/posts/${investorsId}`, { title: 'x', body: 'y', status: 'published', audience: { type: 'all' } }, modToken);
  assert.equal(edit.statusCode, 403);
  assert.equal((await send('DELETE', `/api/admin/posts/${investorsId}`, undefined, modToken)).statusCode, 403);
  assert.equal((await send('POST', `/api/admin/posts/${investorsId}/notify`, undefined, modToken)).statusCode, 403);

  // The admin's targeted messages are not the moderator's to read either.
  const listed = (await get('/api/admin/posts', modToken)).json().posts as { id: string }[];
  assert.ok(!listed.some((post) => [investorsId, neutralsId, oneMemberId].includes(post.id)));
  assert.ok((await get('/api/admin/posts', adminToken)).json().posts.some((post: { id: string }) => post.id === oneMemberId));
});

test('the notification goes exactly where the message goes', async () => {
  const register = (token: string, device: string) => send('POST', '/api/push/tokens', { token: `ExponentPushToken[${device}]`, platform: 'android' }, token);
  assert.equal((await register(users.investor.token, 'inv00001')).statusCode, 200);
  assert.equal((await register(users.neutral.token, 'neu00001')).statusCode, 200);

  pushBatches.length = 0;
  const investorsPush = await send('POST', `/api/admin/posts/${investorsId}/notify`, undefined, adminToken);
  assert.equal(investorsPush.statusCode, 200, investorsPush.body);
  assert.equal(investorsPush.json().sent, 1);
  assert.deepEqual(pushBatches.flat().map((message) => message.to), ['ExponentPushToken[inv00001]']);

  pushBatches.length = 0;
  const memberPush = await send('POST', `/api/admin/posts/${oneMemberId}/notify`, undefined, adminToken);
  assert.equal(memberPush.statusCode, 200, memberPush.body);
  assert.deepEqual(pushBatches.flat().map((message) => message.to), ['ExponentPushToken[inv00001]']);

  // Nobody of the audience registered a device: said plainly, nothing recorded.
  const entId = await publish({ title: 'لرواد الأعمال', body: 'رسالة فئة رواد الأعمال.', audience: { type: 'persona', persona: 'entrepreneur' } });
  const noDevices = await send('POST', `/api/admin/posts/${entId}/notify`, undefined, adminToken);
  assert.equal(noDevices.statusCode, 409);
  assert.equal(noDevices.json().error.code, 'no_devices');
  assert.match(noDevices.json().error.message, /لهذه الفئة/);

  const lonely = await publish({ title: 'لعضو بلا جهاز', body: 'رسالة.', audience: { type: 'member', contactId: users.entrepreneur.id, name: '' } });
  const noDevice = await send('POST', `/api/admin/posts/${lonely}/notify`, undefined, adminToken);
  assert.equal(noDevice.statusCode, 409);
  assert.match(noDevice.json().error.message, /لهذا العضو/);
});

test('the app composer is for admins alone, finds the member and sends message plus push in one act', async () => {
  assert.equal((await get('/api/admin/app/members?q=m29.inv', users.investor.token)).statusCode, 403);
  assert.equal((await send('POST', '/api/admin/app/messages', { title: 'x', body: 'y', audience: { type: 'all' } }, modToken)).statusCode, 403);

  const found = await get('/api/admin/app/members?q=m29.inv', adminToken);
  assert.equal(found.statusCode, 200, found.body);
  const member = (found.json().members as { id: number; name: string; persona: string }[]).find((row) => row.id === users.investor.id);
  assert.ok(member, found.body);
  assert.equal(member.persona, 'investor');

  pushBatches.length = 0;
  const sent = await send('POST', '/api/admin/app/messages', { title: 'من التطبيق', body: 'رسالة خاصة من الأدمن عبر التطبيق.', audience: { type: 'member', contactId: users.investor.id, name: member.name } }, adminToken);
  assert.equal(sent.statusCode, 201, sent.body);
  assert.equal(sent.json().devices, 1);
  assert.equal(sent.json().push.sent, 1);
  assert.deepEqual(pushBatches.flat().map((message) => message.to), ['ExponentPushToken[inv00001]']);
  const composedId = sent.json().post.id as string;
  assert.ok((await feedIds(users.investor.token)).includes(composedId));
  assert.ok(!(await feedIds(users.neutral.token)).includes(composedId));
  assert.ok(!hub.published.some((body) => body.key === composedId));

  // A message to everyone from the composer reaches the hub like any dashboard post.
  const broad = await send('POST', '/api/admin/app/messages', { title: 'إعلان عام', body: 'رسالة عامة من التطبيق.', audience: { type: 'all' } }, adminToken);
  assert.equal(broad.statusCode, 201, broad.body);
  assert.ok(hub.published.some((body) => body.key === broad.json().post.id && !body.remove));
});
