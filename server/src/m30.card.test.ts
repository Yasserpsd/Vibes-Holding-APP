import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { membershipNumber } from './auth/service.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M30: «كارت العضوية» — the card number on /api/me and the print-and-deliver requests.
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
let unpaidToken = '';
let requestId = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string, persona: 'neutral' | 'entrepreneur' | 'investor'): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'عضو الكارت', country: 'sa', phone, email, password: 'secret123', persona, bio: 'حساب اختبار كارت العضوية وطلبات الطباعة.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  // «+member@» makes the mock account an active member; a plain address stays unactivated.
  const member = await signUp('m30+member@gmail.com', '0558618801', 'investor');
  memberToken = member.token;
  memberId = member.id;
  unpaidToken = (await signUp('m30.unpaid@gmail.com', '0558618802', 'neutral')).token;
  // The paying member is a plain member, not one of the club's admins.
  hub.members.add(memberId);
  await get('/api/me?fresh=1', memberToken);
});

after(async () => {
  await app.close();
});

test('the membership number: one category letter and ten digits from the contact id', () => {
  assert.equal(membershipNumber({ id: 42, persona: 'investor' }), 'I-0000000042');
  assert.equal(membershipNumber({ id: 42, persona: 'entrepreneur' }), 'E-0000000042');
  assert.equal(membershipNumber({ id: 42, persona: 'neutral' }), 'N-0000000042');
  assert.equal(membershipNumber({ id: 42, persona: '' }), 'C-0000000042');
  assert.equal(membershipNumber({ id: 12345678901, persona: 'neutral' }), 'N-2345678901');
});

test('/api/me carries the card number', async () => {
  const me = (await get('/api/me', memberToken)).json().me;
  assert.equal(me.cardNumber, `I-${String(memberId).padStart(10, '0')}`);
  assert.equal(me.membership.status, 'active');
});

test('the print request needs a session and an active membership, and the member must write his address', async () => {
  assert.equal((await send('POST', '/api/card/print', { city: 'الرياض', address: 'حي العليا، شارع التحلية، فيلا 12' })).statusCode, 401);

  const refused = await send('POST', '/api/card/print', { city: 'الرياض', address: 'حي العليا، شارع التحلية، فيلا 12' }, unpaidToken);
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().error.code, 'membership_required');

  const invalid = await send('POST', '/api/card/print', { city: 'ر', address: 'قصير' }, memberToken);
  assert.equal(invalid.statusCode, 400);
});

test('the member requests the printed card once; the management is mailed; a second request waits', async () => {
  assert.equal((await get('/api/card/print', memberToken)).json().request, null);

  const before = mailer.sent.length;
  const created = await send('POST', '/api/card/print', { city: 'الرياض', address: 'حي العليا، شارع التحلية، فيلا 12', note: 'التسليم مساءً' }, memberToken);
  assert.equal(created.statusCode, 201, created.body);
  requestId = created.json().request.id;
  assert.equal(created.json().request.status, 'pending');
  // The member sees his own request, never the management fields.
  assert.equal('phone' in created.json().request, false);

  assert.equal(mailer.sent.length, before + 1);
  const mail = mailer.sent.at(-1);
  assert.match(mail?.subject ?? '', /طلب طباعة كارت العضوية/);
  assert.match(mail?.text ?? '', /بدون رسوم/);
  assert.match(mail?.text ?? '', new RegExp(`I-${String(memberId).padStart(10, '0')}`));
  assert.match(mail?.text ?? '', /حي العليا/);

  const again = await send('POST', '/api/card/print', { city: 'الرياض', address: 'حي آخر، شارع آخر 5' }, memberToken);
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'already_requested');

  assert.equal((await get('/api/card/print', memberToken)).json().request.id, requestId);
});

test('the dashboard lists the requests for admins alone and marks them delivered', async () => {
  assert.equal((await get('/api/admin/card-requests', memberToken)).statusCode, 403);

  // The mock makes the plain verified account a hub admin, so it opens the dashboard side.
  const listed = await get('/api/admin/card-requests', unpaidToken);
  assert.equal(listed.statusCode, 200, listed.body);
  const row = (listed.json().requests as { id: string; cardNumber: string; phone: string; city: string }[]).find((entry) => entry.id === requestId);
  assert.ok(row);
  assert.equal(row.cardNumber, `I-${String(memberId).padStart(10, '0')}`);
  assert.equal(row.city, 'الرياض');
  assert.ok(row.phone);

  const done = await send('POST', `/api/admin/card-requests/${requestId}/done`, undefined, unpaidToken);
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().request.status, 'done');
  assert.ok(done.json().request.doneAt);

  // Delivered: the member may ask for a new copy later.
  const fresh = await send('POST', '/api/card/print', { city: 'جدة', address: 'حي الشاطئ، برج 3، شقة 14' }, memberToken);
  assert.equal(fresh.statusCode, 201, fresh.body);
});
