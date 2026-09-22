import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { pollVotesKey } from './polls/service.js';
import { MemoryKV } from './store.js';

// M31: «استفتاء» — polls with any number of options, one changeable vote per member, live results.
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

const hub = new RecordingHub();
const kv = new MemoryKV();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
let modToken = '';
let investor = { token: '', id: 0 };
let neutral = { token: '', id: 0 };
let pollId = '';
let optionIds: string[] = [];

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string, persona: 'neutral' | 'entrepreneur' | 'investor'): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'عضو الاستفتاء', country: 'sa', phone, email, password: 'secret123', persona, bio: 'حساب اختبار استفتاءات الإدارة.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv, hub });
  app = built.app;
  adminToken = (await signUp('m31.admin@gmail.com', '0558718801', 'neutral')).token;
  const moderator = await signUp('m31.mod@gmail.com', '0558718802', 'neutral');
  modToken = moderator.token;
  hub.moderators.add(moderator.id);
  investor = await signUp('m31.inv@gmail.com', '0558718803', 'investor');
  neutral = await signUp('m31.neu@gmail.com', '0558718804', 'neutral');
  hub.members.add(investor.id);
  hub.members.add(neutral.id);
  for (const token of [modToken, investor.token, neutral.token]) await get('/api/me?fresh=1', token);
});

after(async () => {
  await app.close();
});

test('an admin creates a poll with its options; a moderator may not; the hub never hears it', async () => {
  const refusedModerator = await send('POST', '/api/admin/posts', { title: 'استفتاء الموديريتور', body: '', kind: 'poll', status: 'published', poll: { options: [{ label: 'أ' }, { label: 'ب' }] } }, modToken);
  assert.equal(refusedModerator.statusCode, 403);
  assert.match(refusedModerator.json().error.message, /الاستفتاءات/);

  const short = await send('POST', '/api/admin/posts', { title: 'خيار واحد', kind: 'poll', status: 'published', poll: { options: [{ label: 'وحيد' }] } }, adminToken);
  assert.equal(short.statusCode, 400);

  const created = await send(
    'POST',
    '/api/admin/posts',
    { title: 'ما أفضل موعد للقاء الشهري؟', body: 'اختر الموعد الأنسب لك.', kind: 'poll', status: 'published', poll: { options: [{ label: 'السبت مساءً' }, { label: 'الأحد مساءً' }, { label: 'الثلاثاء مساءً' }], resultsVisible: true } },
    adminToken,
  );
  assert.equal(created.statusCode, 201, created.body);
  const post = created.json().post;
  pollId = post.id;
  optionIds = post.poll.options.map((option: { id: string }) => option.id);
  assert.equal(optionIds.length, 3);
  assert.equal(post.poll.closesAt, null);
  assert.ok(!hub.published.some((body) => body.key === pollId), 'the poll must never be handed to the hub');
});

test('the feed shows the poll without counts; a vote answers with them and is final; a guest cannot vote', async () => {
  const feed = (await get('/api/posts?limit=20', investor.token)).json();
  const poll = feed.posts.find((entry: { id: string }) => entry.id === pollId);
  assert.ok(poll, 'the poll reaches the member feed');
  assert.equal(poll.kind, 'poll');
  assert.equal(poll.poll.myVote, null);
  assert.equal(poll.poll.totalVotes, null);
  for (const option of poll.poll.options) assert.equal(option.votes, null);

  assert.equal((await send('POST', `/api/posts/${pollId}/vote`, { optionId: optionIds[0] })).statusCode, 401);
  assert.equal((await send('POST', `/api/posts/${pollId}/vote`, { optionId: 'no-such' }, investor.token)).statusCode, 400);

  const voted = await send('POST', `/api/posts/${pollId}/vote`, { optionId: optionIds[0] }, investor.token);
  assert.equal(voted.statusCode, 200, voted.body);
  assert.equal(voted.json().poll.myVote, optionIds[0]);
  assert.equal(voted.json().poll.totalVotes, 1);

  // The vote is final: a second attempt is refused and the numbers stand.
  const again = await send('POST', `/api/posts/${pollId}/vote`, { optionId: optionIds[1] }, investor.token);
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'already_voted');
  const standing = (await get(`/api/posts/${pollId}`, investor.token)).json().post.poll;
  assert.equal(standing.myVote, optionIds[0]);
  assert.equal(standing.totalVotes, 1);
  const counts = Object.fromEntries(standing.options.map((option: { id: string; votes: number }) => [option.id, option.votes])) as Record<string, number>;
  assert.deepEqual([counts[optionIds[0] ?? ''], counts[optionIds[1] ?? '']], [1, 0]);

  // A member who has not voted still sees no numbers.
  const other = (await get(`/api/posts/${pollId}`, neutral.token)).json().post;
  assert.equal(other.poll.totalVotes, null);
  await send('POST', `/api/posts/${pollId}/vote`, { optionId: optionIds[1] }, neutral.token);
});

test('the dashboard reads live counts; editing labels keeps the votes; a dropped option loses its own', async () => {
  const listed = (await get('/api/admin/posts', adminToken)).json().posts.find((entry: { id: string }) => entry.id === pollId);
  assert.equal(listed.pollResults.totalVotes, 2);

  // Rename an option and drop the third: votes follow the kept ids.
  const edited = await send(
    'PUT',
    `/api/admin/posts/${pollId}`,
    {
      title: 'ما أفضل موعد للقاء الشهري؟',
      body: 'اختر الموعد الأنسب لك.',
      kind: 'poll',
      status: 'published',
      poll: { options: [{ id: optionIds[0], label: 'السبت بعد العشاء' }, { id: optionIds[1], label: 'الأحد مساءً' }], resultsVisible: true },
    },
    adminToken,
  );
  assert.equal(edited.statusCode, 200, edited.body);
  const after = (await get('/api/admin/posts', adminToken)).json().posts.find((entry: { id: string }) => entry.id === pollId);
  assert.equal(after.pollResults.totalVotes, 2);
  assert.equal(after.poll.options.length, 2);
  assert.equal(after.poll.options[0].label, 'السبت بعد العشاء');
});

test('a closed poll takes no vote; hidden results stay the dashboard’s alone', async () => {
  const closed = await send(
    'POST',
    '/api/admin/posts',
    { title: 'استفتاء منتهٍ', kind: 'poll', status: 'published', poll: { options: [{ label: 'أ' }, { label: 'ب' }], closesAt: '2026-09-01' } },
    adminToken,
  );
  assert.equal(closed.statusCode, 201, closed.body);
  const closedId = closed.json().post.id;
  const closedOption = closed.json().post.poll.options[0].id;
  const refused = await send('POST', `/api/posts/${closedId}/vote`, { optionId: closedOption }, investor.token);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().error.code, 'poll_closed');
  const seen = (await get(`/api/posts/${closedId}`, investor.token)).json().post.poll;
  assert.equal(seen.closed, true);
  assert.equal(seen.totalVotes, 0, 'a closed poll shows its numbers');

  const hidden = await send(
    'POST',
    '/api/admin/posts',
    { title: 'استفتاء بنتائج خاصة', kind: 'poll', status: 'published', poll: { options: [{ label: 'أ' }, { label: 'ب' }], resultsVisible: false } },
    adminToken,
  );
  const hiddenId = hidden.json().post.id;
  const hiddenOption = hidden.json().post.poll.options[0].id;
  const voted = await send('POST', `/api/posts/${hiddenId}/vote`, { optionId: hiddenOption }, investor.token);
  assert.equal(voted.json().poll.myVote, hiddenOption);
  assert.equal(voted.json().poll.totalVotes, null, 'hidden results never reach the voter');
  const admin = (await get('/api/admin/posts', adminToken)).json().posts.find((entry: { id: string }) => entry.id === hiddenId);
  assert.equal(admin.pollResults.totalVotes, 1);
});

test('a poll follows its audience, and deleting it takes the votes document too', async () => {
  const targeted = await send(
    'POST',
    '/api/admin/posts',
    { title: 'استفتاء المستثمرين', kind: 'poll', status: 'published', audience: { type: 'persona', persona: 'investor' }, poll: { options: [{ label: 'نعم' }, { label: 'لا' }] } },
    adminToken,
  );
  const targetedId = targeted.json().post.id;
  assert.equal((await get(`/api/posts/${targetedId}`, neutral.token)).statusCode, 404);
  assert.equal((await get(`/api/posts/${targetedId}`, investor.token)).statusCode, 200);

  assert.ok(await kv.get(pollVotesKey(pollId)), 'the first poll holds votes');
  assert.equal((await send('DELETE', `/api/admin/posts/${pollId}`, undefined, modToken)).statusCode, 403);
  assert.equal((await send('DELETE', `/api/admin/posts/${pollId}`, undefined, adminToken)).statusCode, 200);
  assert.equal(await kv.get(pollVotesKey(pollId)), null, 'the votes leave with the poll');
});
