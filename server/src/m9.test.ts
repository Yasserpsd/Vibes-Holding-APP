import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { parseYoutubeId } from './posts/service.js';
import { MemoryKV } from './store.js';
import { TemplateBlurbWriter } from './videos/blurbs.js';

// M9: «رسائل الإدارة» — admin posts, the public feed and the push broadcast.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', PUBLIC_URL: 'http://localhost:3000', ADMIN_ORIGINS: 'https://dashboard.example.com/, http://localhost:5173' });

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
  return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) }), { status: 200 });
};

const hub = new RevocableHub();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
let otherToken = '';
let draftId = '';
let publishedId = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string): Promise<string> {
  const registered = await send('POST', '/api/auth/register', { name: 'مدير تجريبي', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب اختبار لإدارة النادي ومنشوراتها.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return verified.json().token as string;
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, blurbs: new TemplateBlurbWriter(), fetchImpl: fetchStub, mailer: new LogMailer() });
  app = built.app;
  adminToken = await signUp('m9.admin@gmail.com', '0558318801');
  otherToken = await signUp('m9.other@gmail.com', '0558318802');
});

after(async () => {
  await app.close();
});

test('parseYoutubeId accepts ids and usual links, rejects other hosts', () => {
  assert.equal(parseYoutubeId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5'), 'dQw4w9WgXcQ');
  assert.equal(parseYoutubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYoutubeId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYoutubeId('https://vimeo.com/123456'), null);
  assert.equal(parseYoutubeId(''), null);
});

test('admin endpoints need a session; the public feed is open and starts empty', async () => {
  assert.equal((await get('/api/admin/posts')).statusCode, 401);
  assert.equal((await send('POST', '/api/admin/posts', { title: 'x' })).statusCode, 401);
  const feed = await get('/api/posts');
  assert.equal(feed.statusCode, 200);
  assert.deepEqual(feed.json(), { posts: [], more: false });
  assert.equal(feed.headers['cache-control'], 'no-store');
});

test('drafts stay out of the feed; publishing shows the post without admin fields', async () => {
  const draft = await send('POST', '/api/admin/posts', { title: 'مسودة', body: 'نص أولي' }, adminToken);
  assert.equal(draft.statusCode, 201, draft.body);
  draftId = draft.json().post.id;
  assert.equal(draft.json().post.status, 'draft');
  assert.equal(draft.json().post.publishedAt, null);
  const body = { title: 'لقاء الأعضاء', body: 'موعدنا يوم الأحد.', status: 'published', video: 'https://youtu.be/dQw4w9WgXcQ', images: ['https://vcmem.com/a.png'], links: [{ label: 'التسجيل', url: 'https://vcmem.com/r' }] };
  const published = await send('POST', '/api/admin/posts', body, adminToken);
  assert.equal(published.statusCode, 201, published.body);
  publishedId = published.json().post.id;
  assert.equal(published.json().post.youtubeId, 'dQw4w9WgXcQ');
  const feed = (await get('/api/posts')).json();
  assert.deepEqual(feed.posts.map((post: { id: string }) => post.id), [publishedId]);
  assert.equal('author' in feed.posts[0], false);
  assert.equal('status' in feed.posts[0], false);
  assert.equal((await get(`/api/posts/${draftId}`)).statusCode, 404);
  assert.equal((await get(`/api/posts/${publishedId}`)).statusCode, 200);
  assert.equal((await get('/api/admin/posts', adminToken)).json().posts.length, 2);
});

test('bad input is refused: non-YouTube video, non-http link, empty title', async () => {
  const video = await send('POST', '/api/admin/posts', { title: 'فيديو', video: 'https://vimeo.com/1' }, adminToken);
  assert.equal(video.statusCode, 400);
  assert.match(video.json().error.message, /يوتيوب/);
  assert.equal((await send('POST', '/api/admin/posts', { title: 'رابط', links: [{ label: 'x', url: 'javascript:alert(1)' }] }, adminToken)).statusCode, 400);
  assert.equal((await send('POST', '/api/admin/posts', { title: '  ' }, adminToken)).statusCode, 400);
});

test('notify: refused for a draft, broadcast to every device for a published post', async () => {
  const devices = ['ExponentPushToken[m9-admin-device-01]', 'ExponentPushToken[m9-other-device-02]'];
  assert.equal((await send('POST', '/api/push/tokens', { token: devices[0], platform: 'android' }, adminToken)).statusCode, 200);
  assert.equal((await send('POST', '/api/push/tokens', { token: devices[1], platform: 'android' }, otherToken)).statusCode, 200);
  assert.equal((await send('POST', `/api/admin/posts/${draftId}/notify`, undefined, adminToken)).statusCode, 409);
  assert.equal(pushBatches.length, 0);
  const sent = await send('POST', `/api/admin/posts/${publishedId}/notify`, undefined, adminToken);
  assert.equal(sent.statusCode, 200, sent.body);
  assert.equal(sent.json().sent, 2);
  assert.equal(pushBatches.length, 1);
  assert.deepEqual(pushBatches[0]?.map((message) => message.to).sort(), devices);
  assert.deepEqual(pushBatches[0]?.[0]?.data, { type: 'post', postId: publishedId, screen: `/posts/${publishedId}` });
  const stored = (await get('/api/admin/posts', adminToken)).json().posts.find((post: { id: string }) => post.id === publishedId);
  assert.ok(stored.notifiedAt);
});

test('update publishes a draft once and pins it first; delete removes it', async () => {
  const updated = await send('PUT', `/api/admin/posts/${draftId}`, { title: 'مسودة منشورة', body: 'جاهز', status: 'published', pinned: true }, adminToken);
  assert.equal(updated.statusCode, 200, updated.body);
  assert.ok(updated.json().post.publishedAt);
  assert.equal((await get('/api/posts')).json().posts[0].id, draftId);
  assert.equal((await send('DELETE', `/api/admin/posts/${draftId}`, undefined, adminToken)).statusCode, 200);
  assert.equal((await send('DELETE', `/api/admin/posts/${draftId}`, undefined, adminToken)).statusCode, 404);
});

test('an account that lost its admin role is refused (403) once its account is re-read', async () => {
  hub.revoked = true;
  assert.equal((await get('/api/me?fresh=1', otherToken)).statusCode, 200);
  assert.equal((await get('/api/admin/posts', otherToken)).statusCode, 403);
  assert.equal((await send('POST', '/api/admin/posts', { title: 'ممنوع' }, otherToken)).statusCode, 403);
  hub.revoked = false;
});

test('dashboard origins: listed origins are answered, others get no CORS header', async () => {
  const allowed = await app.inject({ method: 'GET', url: '/api/posts', headers: { origin: 'https://dashboard.example.com' } });
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://dashboard.example.com');
  assert.equal(allowed.headers.vary, 'origin');
  const preflight = await app.inject({ method: 'OPTIONS', url: '/api/admin/posts', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.match(String(preflight.headers['access-control-allow-headers']), /authorization/);
  const stranger = await app.inject({ method: 'GET', url: '/api/posts', headers: { origin: 'https://evil.example.com' } });
  assert.equal(stranger.statusCode, 200);
  assert.equal(stranger.headers['access-control-allow-origin'], undefined);
  const plain = await get('/api/posts');
  assert.equal(plain.headers['access-control-allow-origin'], undefined);
});
