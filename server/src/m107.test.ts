import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { matchesInterests, newsTopicsOf } from './interests/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M107: the unified interests, the discount codes, and the agenda's member price + ticket.
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
let built: BuiltApp;
let app: BuiltApp['app'];
let memberToken = '';
let visitorToken = '';
let visitor2Token = '';
let adminToken = '';
let eventId = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'حساب اختبار', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب اختبار الاهتمامات وأكواد الخصم.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer: new LogMailer() });
  app = built.app;
  const member = await signUp('m107+member@gmail.com', '0558619951');
  memberToken = member.token;
  hub.members.add(member.id);
  await get('/api/me?fresh=1', memberToken);
  visitorToken = (await signUp('m107.visitor@gmail.com', '0558619952')).token;
  visitor2Token = (await signUp('m107.visitor2@gmail.com', '0558619953')).token;
  adminToken = (await signUp('m107.admin@gmail.com', '0558619954')).token;
});

after(async () => {
  await app.close();
});

test('the unified interests: 1–3 picks, the «أخرى» text, and the mapped news prefs', async () => {
  const list = await get('/api/interests');
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().interests.length, 10);
  assert.equal(list.json().max, 3);

  // Four picks are refused; three (with «أخرى» and its text) are saved.
  assert.equal((await send('PUT', '/api/me/interests', { keys: ['invest', 'tech', 'realestate', 'energy'] }, memberToken)).statusCode, 400);
  const saved = await send('PUT', '/api/me/interests', { keys: ['invest', 'tourism', 'other'], other: 'الزراعة المائية' }, memberToken);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json().keys, ['invest', 'tourism', 'other']);
  assert.equal(saved.json().other, 'الزراعة المائية');

  const mine = await get('/api/interests', memberToken);
  assert.deepEqual(mine.json().mine.keys, ['invest', 'tourism', 'other']);
  assert.equal(mine.json().saved, true);

  // The news ranking reads the mapped classifier topics behind the picks.
  const prefs = await get('/api/news/prefs', memberToken);
  assert.equal(prefs.json().saved, true);
  assert.deepEqual(prefs.json().topics, ['markets', 'finance', 'economy', 'tourism', 'sports']);

  // The dashboard report counts the picks and lists the «أخرى» texts for the monthly review.
  const report = await get('/api/admin/interests', adminToken);
  assert.equal(report.statusCode, 200);
  assert.equal(report.json().total, 1);
  assert.equal(report.json().others[0].text, 'الزراعة المائية');
  assert.equal((await get('/api/admin/interests', memberToken)).statusCode, 403);

  // The pure mappers behind the Projects Bank filter.
  assert.deepEqual(newsTopicsOf(['tech']), ['tech']);
  assert.ok(matchesInterests(['realestate'], 'التطوير العقاري'));
  assert.ok(!matchesInterests(['energy'], 'التجزئة'));
});

test('discount codes: the dashboard creates them, the member checks them, and uses are counted on confirmation', async () => {
  const created = await send('POST', '/api/admin/discounts', { code: 'half50', percent: 50, maxUses: 1 }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().code.code, 'HALF50');
  assert.equal((await send('POST', '/api/admin/discounts', { code: 'X', percent: 50, maxUses: 1 }, memberToken)).statusCode, 403);

  const check = await send('POST', '/api/discounts/check', { code: 'half50', amount: 150 }, visitorToken);
  assert.equal(check.statusCode, 200, check.body);
  assert.equal(check.json().amountAfter, 75);
  assert.equal((await send('POST', '/api/discounts/check', { code: 'NOPE', amount: 150 }, visitorToken)).statusCode, 404);

  // An event priced for both sides: non-members 150, members 60.
  const event = await send('POST', '/api/admin/agenda', { title: 'ورشة التمويل', date: soon, mode: 'both', feeSar: 150, memberFeeSar: 60, interests: ['invest'], open: true }, adminToken);
  assert.equal(event.statusCode, 201, event.body);
  eventId = event.json().event.id as string;

  // The visitor sees both prices and the membership saving; the code halves HIS fee.
  const seen = await get(`/api/agenda/${eventId}`, visitorToken);
  assert.equal(seen.json().event.myFeeSar, 150);
  assert.equal(seen.json().event.memberFeeSar, 60);
  assert.equal(seen.json().event.savingsSar, 90);
  const preview = await send('POST', `/api/agenda/${eventId}/discount`, { code: 'HALF50' }, visitorToken);
  assert.equal(preview.json().amountAfter, 75);

  // Registration with the code: the payment carries the discounted amount; the webhook confirms and counts the use.
  const registered = await send('POST', `/api/agenda/${eventId}/register`, { attendance: 'online', discountCode: 'HALF50' }, visitorToken);
  assert.equal(registered.statusCode, 201, registered.body);
  const payment = registered.json().payment as { id: string; amount: number; status: string };
  assert.equal(payment.amount, 75);
  assert.equal(payment.status, 'created');
  const done = await send('POST', `/pay/mock/${payment.id}/complete`, { result: 'success' });
  assert.equal(done.statusCode, 303, done.body);
  await built.payments.status();

  const confirmed = await get(`/api/agenda/${eventId}`, visitorToken);
  assert.equal(confirmed.json().event.mine.paid, true);

  const uses = await get('/api/admin/discounts/HALF50/uses', adminToken);
  assert.equal(uses.json().uses.length, 1);
  assert.equal(uses.json().uses[0].amountAfter, 75);

  // maxUses = 1: the next check finds the code exhausted.
  const again = await send('POST', '/api/discounts/check', { code: 'HALF50', amount: 150 }, visitor2Token);
  assert.equal(again.statusCode, 400);
  assert.match(again.body, /استُنفدت/);
});

test('a 100% code confirms with no gateway, and the ticket QR verifies at the door', async () => {
  await send('POST', '/api/admin/discounts', { code: 'VIP100', percent: 100, maxUses: 10 }, adminToken);

  const registered = await send('POST', `/api/agenda/${eventId}/register`, { attendance: 'online', discountCode: 'VIP100' }, visitor2Token);
  assert.equal(registered.statusCode, 201, registered.body);
  assert.equal(registered.json().registration.paid, true);
  const payment = registered.json().payment as { status: string; provider: string; amount: number; checkoutUrl: string };
  assert.equal(payment.status, 'paid');
  assert.equal(payment.provider, 'code');
  assert.equal(payment.amount, 0);
  assert.equal(payment.checkoutUrl, '');

  const uses = await get('/api/admin/discounts/VIP100/uses', adminToken);
  assert.equal(uses.json().uses.length, 1);
  assert.equal(uses.json().uses[0].amountBefore, 150);

  // The ticket: its QR text verifies as a known, not-yet-started attendance (the event is in 10 days).
  const ticket = await get(`/api/agenda/${eventId}/ticket`, visitor2Token);
  assert.equal(ticket.statusCode, 200, ticket.body);
  assert.match(ticket.json().ticket.qr, /^data:image\/png/);
  assert.equal(ticket.json().ticket.state, 'upcoming');
  const verify = await send('POST', '/api/admin/agenda/verify', { code: ticket.json().ticket.code }, adminToken);
  assert.equal(verify.statusCode, 200, verify.body);
  assert.equal(verify.json().valid, false);
  assert.match(verify.json().text, /لم تبدأ/);
  assert.equal(verify.json().attendee.eventTitle, 'ورشة التمويل');
  const unknown = await send('POST', '/api/admin/agenda/verify', { code: 'VCEV:x:doesnotexist' }, adminToken);
  assert.equal(unknown.json().valid, false);
  assert.equal(unknown.json().attendee, null);

  // No ticket without a confirmed attendance.
  assert.equal((await get(`/api/agenda/${eventId}/ticket`, adminToken)).statusCode, 404);
});

test('a member pays the member price, flagged as such', async () => {
  const registered = await send('POST', `/api/agenda/${eventId}/register`, { attendance: 'online' }, memberToken);
  assert.equal(registered.statusCode, 201, registered.body);
  const payment = registered.json().payment as { amount: number; memberPrice: boolean };
  assert.equal(payment.amount, 60);
  assert.equal(payment.memberPrice, true);
});
