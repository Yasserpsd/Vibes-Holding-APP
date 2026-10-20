import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M109: the owner's 2026-10-20 evening batch — the hours wallet (a), the yearly persona change and
// its dashboard request (d), the complete-profile gate (i) and the guest privacy rules (g).
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
const mailer = new LogMailer(console);
let built: BuiltApp;
let app: BuiltApp['app'];
let memberToken = '';
let member2Token = '';
let bareToken = '';
let adminToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string, complete = true): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'عضو اختبار', country: 'sa', phone, email, password: 'secret123', persona: 'neutral', bio: 'حساب اختبار دفعة مالك أكتوبر M109.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  const token = verified.json().token as string;
  if (complete) {
    const done = await send('PATCH', '/api/me', { jobTitle: 'مدير', company: 'شركة الاختبار', city: 'الرياض', website: 'https://example.test', social: 'https://x.com/test' }, token);
    assert.equal(done.statusCode, 200, done.body);
  }
  return { token, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  const member = await signUp('m109+member@gmail.com', '0558711101');
  memberToken = member.token;
  hub.members.add(member.id);
  await get('/api/me?fresh=1', memberToken);
  const member2 = await signUp('m109.two+member@gmail.com', '0558711102');
  member2Token = member2.token;
  hub.members.add(member2.id);
  await get('/api/me?fresh=1', member2Token);
  // A member who never filled his profile: the gate's test subject.
  const bare = await signUp('m109.bare+member@gmail.com', '0558711103', false);
  bareToken = bare.token;
  hub.members.add(bare.id);
  await get('/api/me?fresh=1', bareToken);
  adminToken = (await signUp('m109.admin@gmail.com', '0558711104')).token;
});

after(async () => {
  await app.close();
});

test('M109a: the hours wallet — book, conflict, approve deducts, reject does not, cancel refunds', async () => {
  const hq = await get('/api/hq', memberToken);
  assert.equal(hq.statusCode, 200, hq.body);
  const days = hq.json().days as { date: string }[];
  const [day1, day2, day3] = [days[0]!.date, days[1]!.date, days[2]!.date];

  // The fresh wallet: 24 of 24.
  const fresh = (await get('/api/hq/wallet', memberToken)).json().wallet;
  assert.deepEqual(fresh, { total: 24, used: 0, pending: 0, remaining: 24 });

  // A 2-hour meeting-room booking: pending reserves against the balance, nothing confirms itself.
  const booked = await send('POST', '/api/hq/visits', { date: day1, time: '09:00', note: '', space: 'meeting', hours: 2 }, memberToken);
  assert.equal(booked.statusCode, 200, booked.body);
  const visit = booked.json().visit;
  assert.deepEqual([visit.space, visit.hours, visit.endTime, visit.status], ['meeting', 2, '11:00', 'pending']);
  const reserved = (await get('/api/hq/wallet', memberToken)).json().wallet;
  assert.deepEqual(reserved, { total: 24, used: 0, pending: 2, remaining: 22 });

  // No pass before the administration confirms: the door stays closed from our side.
  assert.equal((await get(`/api/hq/visits/${visit.id}/pass`, memberToken)).statusCode, 400);

  // The span locks the meeting room for everyone: 10:00 overlaps 09:00–11:00.
  const clash = await send('POST', '/api/hq/visits', { date: day1, time: '10:00', note: '', space: 'meeting', hours: 1 }, member2Token);
  assert.equal(clash.statusCode, 400);
  assert.equal(clash.json().error.code, 'full');
  // The office is its own resource, and the calendar marks the meeting room's span unselectable.
  const officeOk = (await get(`/api/hq/slots?date=${day1}&space=office&hours=1`, member2Token)).json().slots as { time: string; available: boolean }[];
  assert.equal(officeOk.find((slot) => slot.time === '10:00')?.available, true);
  const meetingSlots = (await get(`/api/hq/slots?date=${day1}&space=meeting&hours=1`, member2Token)).json().slots as { time: string; available: boolean }[];
  assert.deepEqual(
    [meetingSlots.find((slot) => slot.time === '09:00')?.available, meetingSlots.find((slot) => slot.time === '10:00')?.available, meetingSlots.find((slot) => slot.time === '11:00')?.available],
    [false, false, true],
  );
  // A span that runs past closing time is never offered: 20:00 + 2 hours ends at 22:00.
  const late = (await get(`/api/hq/slots?date=${day1}&space=office&hours=2`, memberToken)).json().slots as { time: string; available: boolean }[];
  assert.equal(late.find((slot) => slot.time === '20:00')?.available, false);

  // The admin confirms: the hours leave the wallet and the pass exists.
  const confirmed = await send('POST', `/api/admin/hq/visits/${visit.id}/decision`, { status: 'confirmed', note: '' }, adminToken);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const charged = (await get('/api/hq/wallet', memberToken)).json().wallet;
  assert.deepEqual(charged, { total: 24, used: 2, pending: 0, remaining: 22 });
  assert.equal((await get(`/api/hq/visits/${visit.id}/pass`, memberToken)).statusCode, 200);

  // A rejected booking deducts nothing.
  const second = await send('POST', '/api/hq/visits', { date: day2, time: '12:00', note: '', space: 'office', hours: 3 }, memberToken);
  assert.equal(second.statusCode, 200, second.body);
  const rejected = await send('POST', `/api/admin/hq/visits/${second.json().visit.id}/decision`, { status: 'rejected', note: 'الموعد مشغول' }, adminToken);
  assert.equal(rejected.statusCode, 200, rejected.body);
  const afterReject = (await get('/api/hq/wallet', memberToken)).json().wallet;
  assert.deepEqual(afterReject, { total: 24, used: 2, pending: 0, remaining: 22 });

  // Cancelling a confirmed future booking gives the hours back.
  const third = await send('POST', '/api/hq/visits', { date: day3, time: '09:00', note: '', space: 'office', hours: 4 }, memberToken);
  assert.equal(third.statusCode, 200, third.body);
  await send('POST', `/api/admin/hq/visits/${third.json().visit.id}/decision`, { status: 'confirmed', note: '' }, adminToken);
  assert.equal((await get('/api/hq/wallet', memberToken)).json().wallet.used, 6);
  const cancelled = await send('POST', `/api/hq/visits/${third.json().visit.id}/cancel`, {}, memberToken);
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.deepEqual((await get('/api/hq/wallet', memberToken)).json().wallet, { total: 24, used: 2, pending: 0, remaining: 22 });

  // Asking for more hours than the wallet holds is refused on the spot.
  const greedy = await send('POST', '/api/hq/visits', { date: day2, time: '09:00', note: '', space: 'office', hours: 12 }, member2Token);
  assert.equal(greedy.statusCode, 200, greedy.body);
  const greedy2 = await send('POST', '/api/hq/visits', { date: day3, time: '09:00', note: '', space: 'meeting', hours: 12 }, member2Token);
  assert.equal(greedy2.statusCode, 200, greedy2.body);
  const over = await send('POST', '/api/hq/visits', { date: days[3]!.date, time: '09:00', note: '', space: 'office', hours: 1 }, member2Token);
  assert.equal(over.statusCode, 400);
  assert.equal(over.json().error.code, 'wallet_exhausted');
});

test('M109d: the yearly window and the dashboard-reviewed change request', async () => {
  // The member spends his yearly change through the e-mailed code.
  const asked = await send('POST', '/api/me/persona/request', { persona: 'investor' }, memberToken);
  assert.equal(asked.statusCode, 200, asked.body);
  assert.equal(asked.json().days, 365);
  const confirmed = await send('POST', '/api/me/persona/confirm', { code: MOCK_CODE }, memberToken);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().me.persona, 'investor');

  // The window is now closed for ~a year, and the cooldown points at the request path.
  const again = await send('POST', '/api/me/persona/request', { persona: 'entrepreneur' }, memberToken);
  assert.equal(again.statusCode, 429);
  assert.equal(again.json().error.code, 'persona_cooldown');
  assert.match(again.json().error.message, /طلب تغيير الصفة/);

  const state = await get('/api/me/persona/state', memberToken);
  assert.equal(state.statusCode, 200, state.body);
  assert.ok(state.json().daysLeft > 360);
  assert.equal(state.json().request, null);

  // The request lands on the dashboard; a second one is refused while the first waits.
  const requested = await send('POST', '/api/me/persona/change-request', { persona: 'entrepreneur', note: 'تغيّر نشاطي' }, memberToken);
  assert.equal(requested.statusCode, 201, requested.body);
  assert.equal((await send('POST', '/api/me/persona/change-request', { persona: 'neutral' }, memberToken)).statusCode, 400);

  const listed = await get('/api/admin/persona-requests?status=pending', adminToken);
  assert.equal(listed.statusCode, 200, listed.body);
  const row = (listed.json().requests as { id: string; to: string; note: string }[]).find((item) => item.note === 'تغيّر نشاطي');
  assert.ok(row, listed.body);

  // Approve applies the persona at the hub at once and the member sees it on the next read.
  const decided = await send('POST', `/api/admin/persona-requests/${row!.id}/decision`, { action: 'approve', note: '' }, adminToken);
  assert.equal(decided.statusCode, 200, decided.body);
  assert.equal(decided.json().request.status, 'approved');
  assert.equal((await get('/api/me?fresh=1', memberToken)).json().me.persona, 'entrepreneur');

  // A rejection changes nothing and carries the admin's note back.
  const second = await send('POST', '/api/me/persona/change-request', { persona: 'investor' }, member2Token);
  // member2 still has his yearly change open, so the request path is refused for him.
  assert.equal(second.statusCode, 400);
  assert.equal(second.json().error.code, 'window_open');
});

test('M109i: the complete-profile gate refuses bookings until the six fields are filled', async () => {
  const hq = await get('/api/hq', bareToken);
  const day = (hq.json().days as { date: string }[])[4]!.date;
  const refused = await send('POST', '/api/hq/visits', { date: day, time: '09:00', purpose: 'اجتماع عمل', note: '' }, bareToken);
  assert.equal(refused.statusCode, 403, refused.body);
  assert.equal(refused.json().error.code, 'profile_incomplete');
  assert.match(refused.json().error.message, /كمّل بياناتك/);

  // Filling the six fields opens the door.
  const completed = await send('PATCH', '/api/me', { jobTitle: 'مؤسس', company: 'شركة', city: 'جدة', website: 'https://example.test', social: 'https://x.com/bare' }, bareToken);
  assert.equal(completed.statusCode, 200, completed.body);
  const allowed = await send('POST', '/api/hq/visits', { date: day, time: '09:00', purpose: 'اجتماع عمل', note: '' }, bareToken);
  assert.equal(allowed.statusCode, 200, allowed.body);
});

test('M109g: guests never reach the «شخصية ومسيرة» detail or its contact data', async () => {
  const guest = await get(`/api/people/${randomUUID()}`);
  assert.equal(guest.statusCode, 403);
  assert.equal(guest.json().error.code, 'members_only');
  assert.match(guest.json().error.message, /حصرية لأعضاء/);
  // The public list carries only the teaser fields (name, title, company, photo).
  const list = await get('/api/people');
  assert.equal(list.statusCode, 200);
  for (const person of list.json().people as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(person).sort(), ['company', 'id', 'name', 'photo', 'title']);
  }
});
