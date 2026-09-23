import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M36: «راسل الإدارة» — the member's thread (active membership only), the dashboard's list and replies.
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
let built: BuiltApp;
let app: BuiltApp['app'];
let memberToken = '';
let memberId = 0;
let adminToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string, persona: 'neutral' | 'entrepreneur' | 'investor'): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'عضو المراسلة', country: 'sa', phone, email, password: 'secret123', persona, bio: 'حساب اختبار مراسلة الإدارة من التطبيق.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  // «+member@» makes the mock account an active member; the plain address stays unactivated (and a hub admin).
  const member = await signUp('m36+member@gmail.com', '0558618811', 'investor');
  memberToken = member.token;
  memberId = member.id;
  adminToken = (await signUp('m36.admin@gmail.com', '0558618812', 'neutral')).token;
  // The writing member is a plain member, not one of the club's admins.
  hub.members.add(memberId);
  await get('/api/me?fresh=1', memberToken);
});

after(async () => {
  await app.close();
});

test('the thread needs a session, and an active annual membership is the door', async () => {
  assert.equal((await get('/api/contact')).statusCode, 401);
  assert.equal((await send('POST', '/api/contact', { text: 'سلام' })).statusCode, 401);

  // A verified account without an active membership is turned to the membership screen.
  const refused = await get('/api/contact', adminToken);
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().error.code, 'membership_required');
  const refusedSend = await send('POST', '/api/contact', { text: 'سلام' }, adminToken);
  assert.equal(refusedSend.statusCode, 403);
});

test('the member writes: one thread, one mail per waiting burst, his screen shows the words', async () => {
  assert.deepEqual((await get('/api/contact', memberToken)).json().messages, []);

  const before = mailer.sent.length;
  const first = await send('POST', '/api/contact', { text: 'السلام عليكم، أريد تفاصيل شراكات قطاع التقنية.' }, memberToken);
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json().message.from, 'member');

  assert.equal(mailer.sent.length, before + 1);
  const mail = mailer.sent.at(-1);
  assert.match(mail?.subject ?? '', /رسالة جديدة من عضو/);
  assert.match(mail?.text ?? '', /شراكات قطاع التقنية/);
  assert.match(mail?.text ?? '', new RegExp(`I-${String(memberId).padStart(10, '0')}`));

  // A second message while the first still waits does not mail again.
  const second = await send('POST', '/api/contact', { text: 'وهل يوجد لقاء قريب في المقر؟' }, memberToken);
  assert.equal(second.statusCode, 201);
  assert.equal(mailer.sent.length, before + 1);

  const mine = (await get('/api/contact', memberToken)).json().messages as { from: string; text: string }[];
  assert.equal(mine.length, 2);
  assert.equal(mine[0]?.from, 'member');

  assert.equal((await send('POST', '/api/contact', { text: '   ' }, memberToken)).statusCode, 400);
});

test('the dashboard: the list counts the waiting messages, opening the thread clears them', async () => {
  // The member himself is no admin.
  assert.equal((await get('/api/admin/contact', memberToken)).statusCode, 403);

  const listed = await get('/api/admin/contact', adminToken);
  assert.equal(listed.statusCode, 200, listed.body);
  const rows = listed.json().threads as { contactId: number; unread: number; lastFrom: string; name: string }[];
  const row = rows.find((entry) => entry.contactId === memberId);
  assert.ok(row);
  assert.equal(row.unread, 2);
  assert.equal(row.lastFrom, 'member');

  const opened = await get(`/api/admin/contact/${memberId}`, adminToken);
  assert.equal(opened.statusCode, 200, opened.body);
  assert.equal((opened.json().thread.messages as unknown[]).length, 2);

  const relisted = await get('/api/admin/contact', adminToken);
  const cleared = (relisted.json().threads as { contactId: number; unread: number }[]).find((entry) => entry.contactId === memberId);
  assert.equal(cleared?.unread, 0);

  assert.equal((await get('/api/admin/contact/999999', adminToken)).statusCode, 404);
});

test('the reply lands in the member thread, and his next message starts a new waiting burst', async () => {
  const replied = await send('POST', `/api/admin/contact/${memberId}/reply`, { text: 'أهلًا بك، تفاصيل الشراكات تصلك خلال يومين.' }, adminToken);
  assert.equal(replied.statusCode, 201, replied.body);
  assert.equal(replied.json().message.from, 'admin');
  assert.ok(replied.json().message.by);

  const mine = (await get('/api/contact', memberToken)).json().messages as { from: string; text: string; by: string | null }[];
  assert.equal(mine.length, 3);
  const landed = mine[2];
  assert.ok(landed);
  assert.equal(landed.from, 'admin');
  assert.match(landed.text, /خلال يومين/);

  // Answered, then the member writes again: the management is mailed anew.
  const before = mailer.sent.length;
  assert.equal((await send('POST', '/api/contact', { text: 'شكرًا لكم، في الانتظار.' }, memberToken)).statusCode, 201);
  assert.equal(mailer.sent.length, before + 1);

  assert.equal((await send('POST', '/api/admin/contact/999999/reply', { text: 'رد' }, adminToken)).statusCode, 404);
  assert.equal((await send('POST', `/api/admin/contact/${memberId}/reply`, { text: '' }, adminToken)).statusCode, 400);
});
