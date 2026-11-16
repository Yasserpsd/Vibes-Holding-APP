import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';
import { TemplateBlurbWriter } from './videos/blurbs.js';

// M243: who opened each management message — recorded on the message screen, listed for the dashboard.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', AUTO_PUSH: '0', PUBLIC_URL: 'http://localhost:3000', ADMIN_ORIGINS: 'https://dashboard.example.com/, http://localhost:5173' });

/** The mock hub makes every verified account an admin; this wrapper can revoke that after sign-in. */
class RevocableHub implements HubClient {
  readonly mode = 'mock' as const;
  revoked = false;
  private readonly inner = new MockHubClient();
  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    const response = await this.inner.call(op, body);
    if (this.revoked && response.contact) return { ...response, contact: { ...response.contact, is_admin: 0 } };
    return response;
  }
}

type PushMessage = { to: string; title: string; body: string; data: Record<string, string> };
const pushBatches: PushMessage[][] = [];
const fetchStub: typeof fetch = async (input, init) => {
  if (String(input) !== 'https://exp.host/--/api/v2/push/send') throw new Error(`unexpected fetch: ${String(input)}`);
  const messages = JSON.parse(String(init?.body)) as PushMessage[];
  pushBatches.push(messages);
  const ticket = { status: 'ok', id: 'ticket' };
  return new Response(JSON.stringify({ data: messages.map(() => ticket) }), { status: 200 });
};

const hub = new RevocableHub();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
let otherToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string): Promise<string> {
  const registered = await send('POST', '/api/auth/register', { name: 'ماجد العمري', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب اختبار لإدارة النادي ومنشوراتها.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return verified.json().token as string;
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, blurbs: new TemplateBlurbWriter(), fetchImpl: fetchStub, mailer: new LogMailer() });
  app = built.app;
  adminToken = await signUp('m243.admin@gmail.com', '0558324301');
  otherToken = await signUp('m243.other@gmail.com', '0558324302');
});

after(async () => {
  await app.close();
});

test('a signed-in open is recorded once per visit; guests are not; the dashboard lists names and counts', async () => {
  const made = await send('POST', '/api/admin/posts', { title: 'رسالة للقراءة', body: 'نص الرسالة', status: 'published' }, adminToken);
  assert.equal(made.statusCode, 201, made.body);
  const id = made.json().post.id as string;

  assert.equal((await get(`/api/posts/${id}`)).statusCode, 200); // a guest: nothing recorded
  assert.equal((await get(`/api/posts/${id}`, otherToken)).statusCode, 200);
  assert.equal((await get(`/api/posts/${id}`, otherToken)).statusCode, 200); // the same visit: still one open
  await new Promise((resolve) => setTimeout(resolve, 20)); // the record is not awaited by the reader

  const list = (await get('/api/admin/posts', adminToken)).json() as { posts: { id: string; opened: number }[] };
  assert.equal(list.posts.find((post) => post.id === id)?.opened, 1);

  const opens = await get(`/api/admin/posts/${id}/opens`, adminToken);
  assert.equal(opens.statusCode, 200, opens.body);
  const rows = opens.json().opens as { contactId: number; name: string; persona: string; count: number }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.name, 'ماجد العمري');
  assert.equal(rows[0]?.persona, 'investor');
  assert.equal(rows[0]?.count, 1);

  assert.equal((await send('DELETE', `/api/admin/posts/${id}`, undefined, adminToken)).statusCode, 200);
  assert.equal((await get(`/api/admin/posts/${id}/opens`, adminToken)).statusCode, 404);
});
