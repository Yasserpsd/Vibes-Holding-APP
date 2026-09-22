import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { MemoryKV } from './store.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';

// M28: two admin levels — moderator (hub role `publisher`, posts only) and admin (everything).
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });

/** The mock hub makes every verified account an admin; this wrapper turns chosen ids into moderators or plain members. */
class LeveledHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly moderators = new Set<number>();
  readonly members = new Set<number>();
  private readonly inner = new MockHubClient();
  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    const response = await this.inner.call(op, body);
    const contact = response.contact;
    if (contact && this.moderators.has(contact.id)) return { ...response, contact: { ...contact, is_admin: 0, role: 'publisher' } };
    if (contact && this.members.has(contact.id)) return { ...response, contact: { ...contact, is_admin: 0, role: 'member' } };
    return response;
  }
}

const hub = new LeveledHub();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
let modToken = '';
let modId = 0;
let memberToken = '';
let postId = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'حساب مستويات', country: 'sa', phone, email, password: 'secret123', persona: 'neutral', bio: 'حساب اختبار مستويات الإدارة في اللوحة.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub });
  app = built.app;
  adminToken = (await signUp('m28.admin@gmail.com', '0558418701')).token;
  const moderator = await signUp('m28.mod@gmail.com', '0558418702');
  modToken = moderator.token;
  modId = moderator.id;
  hub.moderators.add(modId);
  const member = await signUp('m28.member@gmail.com', '0558418703');
  memberToken = member.token;
  hub.members.add(member.id);
  // The sign-ups above were cached as admins (mock tester rule); a fresh read stores the wrapped level.
  await get('/api/me?fresh=1', modToken);
  await get('/api/me?fresh=1', memberToken);
});

after(async () => {
  await app.close();
});

test('me names the level and the dashboard sign-in admits a moderator', async () => {
  const me = (await get('/api/me?fresh=1', modToken)).json().me;
  assert.equal(me.isAdmin, false);
  assert.equal(me.isModerator, true);

  const login = await send('POST', '/api/admin/auth/login', { login: 'm28.mod@gmail.com', password: 'secret123' });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().me.isModerator, true);

  const refused = await send('POST', '/api/admin/auth/login', { login: 'm28.member@gmail.com', password: 'secret123' });
  assert.equal(refused.statusCode, 403);
});

test('a moderator publishes posts and uploads media, nothing else', async () => {
  const list = await get('/api/admin/posts', modToken);
  assert.equal(list.statusCode, 200, list.body);
  assert.equal((await get('/api/admin/uploads/config', modToken)).statusCode, 200);

  const created = await send('POST', '/api/admin/posts', { title: 'خبر من الموديريتور', body: 'منشور اختبار من حساب موديريتور.', status: 'published', links: [], images: [] }, modToken);
  assert.equal(created.statusCode, 201, created.body);
  postId = created.json().post.id as string;
  assert.equal(created.json().post.hubSync.state, 'ok', created.body);

  // Everything outside posts and uploads answers 403 naming the admin level.
  for (const url of ['/api/admin/home', '/api/admin/accounts', '/api/admin/threads', '/api/admin/mail', '/api/admin/audit', '/api/admin/strings', '/api/admin/content']) {
    const res = await get(url, modToken);
    assert.equal(res.statusCode, 403, `${url} ${res.statusCode}`);
    assert.equal(res.json().error.message, 'هذا القسم لحسابات الأدمن فقط', url);
  }
  assert.equal((await send('POST', '/api/admin/accounts/1/role', { role: 'publisher', confirm: true }, modToken)).statusCode, 403);
  // The app's reception screens stay admin-only.
  assert.equal((await get('/api/admin/hq/visits', modToken)).statusCode, 403);
});

test('a plain member and the admin keep their doors', async () => {
  assert.equal((await get('/api/admin/posts', memberToken)).statusCode, 403);
  assert.equal((await send('POST', '/api/admin/posts', { title: 'x', body: 'y', status: 'draft', links: [], images: [] }, memberToken)).statusCode, 403);

  assert.equal((await get('/api/admin/home', adminToken)).statusCode, 200);
  const removed = await send('DELETE', `/api/admin/posts/${postId}`, undefined, adminToken);
  assert.equal(removed.statusCode, 200, removed.body);
});
