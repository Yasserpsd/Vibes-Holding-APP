import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { MemoryKV } from './store.js';
import { accountInAudience } from './whatsapp/tell.js';

// M273 (owner, 2026-11-25): a management message for whoever paid / did not pay, alone or inside one category.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });

/** Wraps the mock hub: the chosen ids are plain members (the mock makes every sign-up an admin). */
class MembersHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly members = new Set<number>();
  private readonly inner = new MockHubClient();
  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    const response = await this.inner.call(op, body);
    const contact = response.contact;
    return contact && this.members.has(contact.id) ? { ...response, contact: { ...contact, is_admin: 0, role: 'member' } } : response;
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

const hub = new MembersHub();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
type User = { token: string; id: number };
const users = {} as Record<'paidInvestor' | 'unpaidInvestor' | 'unpaidNeutral', User>;

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(name: string, email: string, phone: string, persona: 'neutral' | 'investor'): Promise<User> {
  const registered = await send('POST', '/api/auth/register', { name, country: 'sa', phone, email, password: 'secret123', persona, bio: 'حساب اختبار رسائل المدفوع وغير المدفوع.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

const feed = async (token?: string): Promise<{ id: string; audience: string }[]> => {
  const answer = await get('/api/posts?limit=50', token);
  assert.equal(answer.statusCode, 200, answer.body);
  return answer.json().posts as { id: string; audience: string }[];
};
const feedIds = async (token?: string) => (await feed(token)).map((post) => post.id);

const publish = async (title: string, audience: Record<string, unknown>): Promise<string> => {
  const created = await send('POST', '/api/admin/posts', { title, body: 'نص الرسالة.', status: 'published', audience }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  return created.json().post.id as string;
};

const reach = async (audience: Record<string, unknown>): Promise<{ members: number | null; devices: number }> => {
  const answer = await send('POST', '/api/admin/posts/reach', { audience }, adminToken);
  assert.equal(answer.statusCode, 200, answer.body);
  return answer.json() as { members: number | null; devices: number };
};

const PAID = { type: 'paid', paid: 'paid' };
const UNPAID = { type: 'paid', paid: 'unpaid' };
const UNPAID_INVESTORS = { type: 'persona', persona: 'investor', paid: 'unpaid' };
const PAID_INVESTORS = { type: 'persona', persona: 'investor', paid: 'paid' };

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, fetchImpl: fetchStub });
  app = built.app;
  adminToken = (await signUp('ناصر العلي', 'm273.admin@gmail.com', '0558527301', 'neutral')).token;
  users.paidInvestor = await signUp('سالم القحطاني', 'm273.paid@gmail.com', '0558527302', 'investor');
  users.unpaidInvestor = await signUp('فهد الزهراني', 'm273.inv@gmail.com', '0558527303', 'investor');
  users.unpaidNeutral = await signUp('خالد الحربي', 'm273.neu@gmail.com', '0558527304', 'neutral');
  for (const user of Object.values(users)) hub.members.add(user.id);
  // One of the two investors holds an active annual membership.
  await hub.call('activate_member', { contact_id: users.paidInvestor.id, days: 365, reference: 'GPA.273', product: 'club_membership_annual', store: 'PLAY_STORE' });
  for (const user of Object.values(users)) await get('/api/me?fresh=1', user.token);
});

after(async () => {
  await app.close();
});

test('a message for whoever paid / did not pay reaches exactly them, alone or inside one category', async () => {
  const paidId = await publish('للمدفوع', PAID);
  const unpaidId = await publish('لمن لم يدفع', UNPAID);
  const unpaidInvestorsId = await publish('مستثمر لم يدفع', UNPAID_INVESTORS);
  const paidInvestorsId = await publish('مستثمر مدفوع', PAID_INVESTORS);
  const mine = (ids: string[]) => ids.filter((id) => [paidId, unpaidId, unpaidInvestorsId, paidInvestorsId].includes(id)).sort();

  assert.deepEqual(mine(await feedIds(users.paidInvestor.token)), [paidId, paidInvestorsId].sort());
  assert.deepEqual(mine(await feedIds(users.unpaidInvestor.token)), [unpaidId, unpaidInvestorsId].sort());
  assert.deepEqual(mine(await feedIds(users.unpaidNeutral.token)), [unpaidId]);
  // A guest has no payment state: none of the four is his.
  assert.deepEqual(mine(await feedIds()), []);

  // The app labels it like a message for a category; the wrong reader meets a missing message.
  assert.equal((await feed(users.unpaidNeutral.token)).find((post) => post.id === unpaidId)?.audience, 'persona');
  assert.equal((await get(`/api/posts/${paidId}`, users.unpaidInvestor.token)).statusCode, 404);
  assert.equal((await get(`/api/posts/${unpaidId}`, users.paidInvestor.token)).statusCode, 404);
  assert.equal((await get(`/api/posts/${paidId}`, users.paidInvestor.token)).statusCode, 200);
});

test('the notification and the dashboard count follow the same filter', async () => {
  const register = (token: string, device: string) => send('POST', '/api/push/tokens', { token: `ExponentPushToken[${device}]`, platform: 'android' }, token);
  assert.equal((await register(users.paidInvestor.token, 'paid0001')).statusCode, 200);
  assert.equal((await register(users.unpaidInvestor.token, 'inv00001')).statusCode, 200);
  assert.equal((await register(users.unpaidNeutral.token, 'neu00001')).statusCode, 200);

  // The registry holds four accounts: the admin (neutral, not paid) and the three members.
  assert.deepEqual(await reach(PAID), { members: 1, devices: 1 });
  assert.deepEqual(await reach(UNPAID), { members: 3, devices: 2 });
  assert.deepEqual(await reach(UNPAID_INVESTORS), { members: 1, devices: 1 });
  assert.deepEqual(await reach({ type: 'persona', persona: 'neutral', paid: 'paid' }), { members: 0, devices: 0 });
  assert.deepEqual(await reach({ type: 'persona', persona: 'investor' }), { members: 2, devices: 2 });
  assert.deepEqual(await reach({ type: 'all' }), { members: 4, devices: 3 });
  assert.deepEqual(await reach({ type: 'members', members: [{ contactId: users.unpaidNeutral.id, name: 'خالد' }] }), { members: 1, devices: 1 });

  const notified = async (audience: Record<string, unknown>): Promise<string[]> => {
    const id = await publish('رسالة لم تُفتح', audience);
    pushBatches.length = 0;
    const pushed = await send('POST', `/api/admin/posts/${id}/notify`, undefined, adminToken);
    assert.equal(pushed.statusCode, 200, pushed.body);
    return pushBatches.flat().map((message) => message.to).sort();
  };
  assert.deepEqual(await notified(PAID), ['ExponentPushToken[paid0001]']);
  assert.deepEqual(await notified(UNPAID), ['ExponentPushToken[inv00001]', 'ExponentPushToken[neu00001]']);
  assert.deepEqual(await notified(UNPAID_INVESTORS), ['ExponentPushToken[inv00001]']);

  // Nobody is a paid neutral: the reminder says so instead of reporting a sent notification.
  const emptyId = await publish('محايد مدفوع', { type: 'persona', persona: 'neutral', paid: 'paid' });
  const empty = await send('POST', `/api/admin/posts/${emptyId}/notify`, undefined, adminToken);
  assert.equal(empty.statusCode, 409, empty.body);
  assert.equal(empty.json().error.code, 'no_devices');
});

test('the payment state is one of the two words', async () => {
  const bad = await send('POST', '/api/admin/posts', { title: 'خطأ', body: 'نص.', status: 'draft', audience: { type: 'paid', paid: 'later' } }, adminToken);
  assert.equal(bad.statusCode, 400, bad.body);
  const missing = await send('POST', '/api/admin/posts/reach', { audience: { type: 'paid' } }, adminToken);
  assert.equal(missing.statusCode, 400, missing.body);
});

test('WhatsApp follows the same rule over the hub registry', () => {
  const member = { state: 'member', honorary: 0, persona: 'investor' };
  const unpaid = { state: 'unpaid', honorary: 0, persona: 'investor' };
  const expired = { state: 'expired', honorary: 0, persona: 'neutral' };
  assert.equal(accountInAudience(member, null, 'paid'), true);
  assert.equal(accountInAudience(member, null, 'unpaid'), false);
  assert.equal(accountInAudience(unpaid, null, 'unpaid'), true);
  assert.equal(accountInAudience(unpaid, null, 'paid'), false);
  // An expired membership counts as «لم يدفع».
  assert.equal(accountInAudience(expired, null, 'unpaid'), true);
  assert.equal(accountInAudience(expired, 'investor', 'unpaid'), false);
  assert.equal(accountInAudience(unpaid, 'investor', 'unpaid'), true);
  // No payment filter: the rule of M236 as it was.
  assert.equal(accountInAudience(member, 'investor'), true);
  assert.equal(accountInAudience(expired, null), true);
  // Never an honorary member, an unverified sign-up or a lead.
  assert.equal(accountInAudience({ state: 'member', honorary: 1, persona: 'investor' }, null, 'paid'), false);
  assert.equal(accountInAudience({ state: 'pending', honorary: 0, persona: 'investor' }, null, 'unpaid'), false);
  assert.equal(accountInAudience({ state: 'lead', honorary: 0, persona: '' }, null, 'unpaid'), false);
});

test('a member who paid after his device last registered is judged by the hub, not by the device', async () => {
  // The neutral member pays now; his device still carries «لم يدفع» from its last launch.
  await hub.call('activate_member', { contact_id: users.unpaidNeutral.id, days: 365, reference: 'GPA.273b', product: 'club_membership_annual', store: 'PLAY_STORE' });
  await get('/api/me?fresh=1', users.unpaidNeutral.token);
  const notified = async (audience: Record<string, unknown>): Promise<string[]> => {
    const id = await publish('رسالة بعد الدفع', audience);
    pushBatches.length = 0;
    const pushed = await send('POST', `/api/admin/posts/${id}/notify`, undefined, adminToken);
    assert.equal(pushed.statusCode, 200, pushed.body);
    return pushBatches.flat().map((message) => message.to).sort();
  };
  assert.deepEqual(await notified(UNPAID), ['ExponentPushToken[inv00001]']);
  assert.deepEqual(await notified(PAID), ['ExponentPushToken[neu00001]', 'ExponentPushToken[paid0001]']);
  // His inbox follows at once too.
  const paidId = await publish('للمدفوع الآن', PAID);
  assert.equal((await feedIds(users.unpaidNeutral.token)).includes(paidId), true);
});
