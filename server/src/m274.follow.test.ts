import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { MemoryKV } from './store.js';

// M274 (owner, 2026-11-25): the dashboard follows a message member by member — who opened, who did not, who chose what.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });

/** Wraps the mock hub: the chosen ids are plain members or moderators (the mock makes every sign-up an admin). */
class RolesHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly members = new Set<number>();
  readonly moderators = new Set<number>();
  private readonly inner = new MockHubClient();
  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    const response = await this.inner.call(op, body);
    const contact = response.contact;
    if (contact && this.moderators.has(contact.id)) return { ...response, contact: { ...contact, is_admin: 0, role: 'publisher' } };
    return contact && this.members.has(contact.id) ? { ...response, contact: { ...contact, is_admin: 0, role: 'member' } } : response;
  }
}

const hub = new RolesHub();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
let modToken = '';
type User = { token: string; id: number };
const users = {} as Record<'voter' | 'reader' | 'silent' | 'neutral', User>;

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (url: string, payload: Record<string, unknown>, token?: string) => app.inject({ method: 'POST', url, payload, headers: bearer(token) });

async function signUp(name: string, email: string, phone: string, persona: 'neutral' | 'investor'): Promise<User> {
  const registered = await send('/api/auth/register', { name, country: 'sa', phone, email, password: 'secret123', persona, bio: 'حساب اختبار متابعة الرسائل عضوًا عضوًا.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

type FollowRow = { contactId: number; name: string; persona: string; opened: { first: string; last: string; count: number } | null; vote: string | null };
const follow = async (postId: string): Promise<{ rows: FollowRow[]; options: { id: string; label: string }[]; complete: boolean }> => {
  const answer = await get(`/api/admin/posts/${postId}/follow`, adminToken);
  assert.equal(answer.statusCode, 200, answer.body);
  return answer.json() as { rows: FollowRow[]; options: { id: string; label: string }[]; complete: boolean };
};

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub });
  app = built.app;
  adminToken = (await signUp('ناصر العلي', 'm274.admin@gmail.com', '0558527401', 'neutral')).token;
  const moderator = await signUp('ماجد المطيري', 'm274.mod@gmail.com', '0558527402', 'neutral');
  modToken = moderator.token;
  hub.moderators.add(moderator.id);
  users.voter = await signUp('سالم القحطاني', 'm274.voter@gmail.com', '0558527403', 'investor');
  users.reader = await signUp('فهد الزهراني', 'm274.reader@gmail.com', '0558527404', 'investor');
  users.silent = await signUp('خالد الحربي', 'm274.silent@gmail.com', '0558527405', 'investor');
  users.neutral = await signUp('تركي العتيبي', 'm274.neutral@gmail.com', '0558527406', 'neutral');
  for (const user of Object.values(users)) hub.members.add(user.id);
  for (const token of [modToken, ...Object.values(users).map((user) => user.token)]) await get('/api/me?fresh=1', token);
});

after(async () => {
  await app.close();
});

test('a poll is followed member by member: who chose what, who only opened, who did not open', async () => {
  const created = await send('/api/admin/posts', { title: 'استفتاء المستثمرين', body: 'نص يصل مع الاستفتاء.', status: 'published', kind: 'poll', poll: { options: [{ label: 'نعم' }, { label: 'لا' }], closesAt: null, resultsVisible: true }, audience: { type: 'persona', persona: 'investor' } }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  const postId = created.json().post.id as string;
  const yes = (created.json().post.poll.options as { id: string; label: string }[])[0];
  assert.ok(yes);

  // The message text travels with the poll to the app.
  const opened = await get(`/api/posts/${postId}`, users.voter.token);
  assert.equal(opened.statusCode, 200, opened.body);
  assert.match(opened.json().post.body as string, /نص يصل مع الاستفتاء\./);
  assert.equal((await send(`/api/posts/${postId}/vote`, { optionId: yes.id }, users.voter.token)).statusCode, 200);
  assert.equal((await get(`/api/posts/${postId}`, users.reader.token)).statusCode, 200);
  // The open is recorded off the request's path.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const list = await follow(postId);
  assert.equal(list.complete, true);
  assert.deepEqual(list.options.map((option) => option.label), ['نعم', 'لا']);
  // The three investors, and nobody else (the neutral member, the admin and the moderator are not its audience).
  assert.deepEqual(list.rows.map((row) => row.contactId).sort(), [users.voter.id, users.reader.id, users.silent.id].sort());
  const row = (user: User) => list.rows.find((entry) => entry.contactId === user.id) as FollowRow;
  assert.equal(row(users.voter).vote, yes.id);
  assert.equal(row(users.voter).opened?.count, 1);
  assert.equal(row(users.voter).name, 'سالم القحطاني');
  assert.equal(row(users.voter).persona, 'investor');
  assert.equal(row(users.reader).vote, null);
  assert.ok(row(users.reader).opened);
  assert.equal(row(users.silent).vote, null);
  assert.equal(row(users.silent).opened, null);
  assert.equal(row(users.silent).name, 'خالد الحربي');

  // Names are the admin's alone; a member has no way in.
  assert.equal((await get(`/api/admin/posts/${postId}/follow`, modToken)).statusCode, 403);
  assert.notEqual((await get(`/api/admin/posts/${postId}/follow`, users.voter.token)).statusCode, 200);
});

test('a message for named members lists exactly them', async () => {
  const created = await send('/api/admin/posts', { title: 'رسالة خاصة', body: 'لك وحدك.', status: 'published', audience: { type: 'member', contactId: users.neutral.id, name: 'تركي العتيبي' } }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  const before = await follow(created.json().post.id as string);
  assert.deepEqual(before.rows.map((entry) => [entry.contactId, entry.opened, entry.vote]), [[users.neutral.id, null, null]]);
  assert.deepEqual(before.options, []);
  // He reads it with his own name on top.
  const read = await get(`/api/posts/${created.json().post.id as string}`, users.neutral.token);
  assert.equal(read.statusCode, 200, read.body);
  assert.match(read.json().post.body as string, /^الأستاذ\/ تركي،/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await follow(created.json().post.id as string)).rows[0]?.opened?.count, 1);
});
