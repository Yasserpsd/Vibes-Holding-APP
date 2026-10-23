import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M41 «أجندة النادي»: events across the year from the dashboard; ONE-tap attendance — members (and
// no-fee events) at once, a visitor without a membership pays inside the app and only the signed
// webhook confirms him (rule 5).
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
let visitorToken = '';
let adminToken = '';
let feeEventId = '';
let freeEventId = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'ضيف الأجندة', country: 'sa', phone, email, password: 'secret123', persona: 'neutral', bio: 'حساب اختبار أجندة النادي وفعالياتها.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  const token = verified.json().token as string;
  // M109i: registrations sit behind the complete-profile gate — the test accounts fill the six fields.
  const completed = await send('PATCH', '/api/me', { jobTitle: 'مدير', company: 'شركة الاختبار', city: 'الرياض', website: 'https://example.test', social: 'https://x.com/test' }, token);
  assert.equal(completed.statusCode, 200, completed.body);
  return { token, id: verified.json().me.id as number };
}

const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  const member = await signUp('m41+member@gmail.com', '0558618841');
  memberToken = member.token;
  hub.members.add(member.id);
  await get('/api/me?fresh=1', memberToken);
  // A verified account WITHOUT «+member»: unactivated membership → the fee applies to him.
  visitorToken = (await signUp('m41.visitor@gmail.com', '0558618842')).token;
  adminToken = (await signUp('m41.admin@gmail.com', '0558618843')).token;
});

after(async () => {
  await app.close();
});

test('the dashboard creates events and the public agenda lists the upcoming ones', async () => {
  const fee = await send('POST', '/api/admin/agenda', { title: 'ملتقى المستثمرين الشهري', blurb: 'لقاء الشهر في المقر وأونلاين.', date: soon, time: '19:00', endTime: '21:00', place: 'مقر النادي بالرياض', onlineUrl: 'https://meet.example.test/club', mode: 'both', feeSar: 150, open: true }, adminToken);
  assert.equal(fee.statusCode, 201, fee.body);
  feeEventId = fee.json().event.id as string;

  const free = await send('POST', '/api/admin/agenda', { title: 'ورشة بدون رسوم', date: soon, mode: 'online', feeSar: 0, open: true }, adminToken);
  assert.equal(free.statusCode, 201, free.body);
  freeEventId = free.json().event.id as string;

  assert.equal((await send('POST', '/api/admin/agenda', { title: 'ممنوع', date: soon, mode: 'both' }, memberToken)).statusCode, 403);

  const pub = await get('/api/agenda');
  const events = pub.json().events as { id: string; mine: unknown; mustPay: boolean; onlineUrl: string | null }[];
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.mine === null && event.mustPay === false && event.onlineUrl === null));

  // M77: the owner-uploaded hero image travels to the public event, and clears with null.
  const pictured = await send('PUT', `/api/admin/agenda/${feeEventId}`, { imageUrl: 'https://cdn.example.test/media/event.webp' }, adminToken);
  assert.equal(pictured.statusCode, 200, pictured.body);
  const withImage = await get(`/api/agenda/${feeEventId}`);
  assert.equal(withImage.json().event.imageUrl, 'https://cdn.example.test/media/event.webp');
  await send('PUT', `/api/admin/agenda/${feeEventId}`, { imageUrl: null }, adminToken);
  assert.equal((await get(`/api/agenda/${feeEventId}`)).json().event.imageUrl, null);

  // M75: the badges signal carries the fresh events' times for the home badge; a visitor gets no account list.
  const badges = await get('/api/badges');
  assert.equal(badges.statusCode, 200, badges.body);
  assert.equal(badges.headers['cache-control'], 'no-store');
  assert.ok((badges.json().home as string[]).length >= 2);
  assert.deepEqual(badges.json().account, []);
});

test('a member registers with one tap: confirmed at once, mailed, and duplicates are refused', async () => {
  const before = mailer.sent.length;
  const registered = await send('POST', `/api/agenda/${feeEventId}/register`, { attendance: 'hq' }, memberToken);
  assert.equal(registered.statusCode, 201, registered.body);
  assert.equal(registered.json().registration.paid, true);
  assert.equal(registered.json().payment, null);
  assert.equal(mailer.sent.length, before + 1);
  assert.match(mailer.sent.at(-1)?.text ?? '', /عضو — بدون رسوم/);

  assert.equal((await send('POST', `/api/agenda/${feeEventId}/register`, { attendance: 'online' }, memberToken)).statusCode, 409);

  const mine = await get('/api/agenda', memberToken);
  const event = (mine.json().events as { id: string; mine: { attendance: string; paid: boolean } | null }[]).find((entry) => entry.id === feeEventId);
  assert.deepEqual(event?.mine, { attendance: 'hq', paid: true });
});

test('the mode is enforced and guests are asked to sign in', async () => {
  assert.equal((await send('POST', `/api/agenda/${freeEventId}/register`, { attendance: 'hq' }, memberToken)).statusCode, 400);
  assert.equal((await send('POST', `/api/agenda/${freeEventId}/register`, { attendance: 'online' })).statusCode, 401);
});

test('a visitor without a membership pays the fee: confirmed only by the signed webhook', async () => {
  const seen = await get('/api/agenda', visitorToken);
  const row = (seen.json().events as { id: string; mustPay: boolean }[]).find((entry) => entry.id === feeEventId);
  assert.equal(row?.mustPay, true);

  const started = await send('POST', `/api/agenda/${feeEventId}/register`, { attendance: 'online' }, visitorToken);
  assert.equal(started.statusCode, 201, started.body);
  assert.equal(started.json().registration.paid, false);
  const payment = started.json().payment as { id: string; amount: number; checkoutUrl: string; serviceTitle: string };
  assert.equal(payment.amount, 150);
  assert.match(payment.serviceTitle, /ملتقى المستثمرين/);
  assert.ok(payment.checkoutUrl);

  // Registering again before paying starts a fresh checkout instead of a 409.
  const retried = await send('POST', `/api/agenda/${feeEventId}/register`, { attendance: 'online' }, visitorToken);
  assert.equal(retried.statusCode, 201);
  const retryPayment = retried.json().payment as { id: string };
  assert.notEqual(retryPayment.id, payment.id);

  // The gateway's signed callback (mock = the same HMAC path) confirms the registration.
  const before = mailer.sent.length;
  await built.payments.mockComplete(retryPayment.id, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const after = await get(`/api/agenda/${feeEventId}`, visitorToken);
  assert.deepEqual(after.json().event.mine, { attendance: 'online', paid: true });
  // The confirmed online attendee now sees the attendance link.
  assert.equal(after.json().event.onlineUrl, 'https://meet.example.test/club');
  assert.ok(mailer.sent.length > before);
  assert.match(mailer.sent.map((mail) => mail.subject).join('\n'), /تسجيل حضور/);

  assert.equal((await send('POST', `/api/agenda/${feeEventId}/register`, { attendance: 'online' }, visitorToken)).statusCode, 409);
});

test('a failed payment never confirms the registration', async () => {
  const event = await send('POST', '/api/admin/agenda', { title: 'فعالية برسوم للاختبار', date: soon, mode: 'online', feeSar: 50, open: true }, adminToken);
  const id = event.json().event.id as string;
  const started = await send('POST', `/api/agenda/${id}/register`, { attendance: 'online' }, visitorToken);
  const payment = started.json().payment as { id: string };
  await built.payments.mockComplete(payment.id, false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const after = await get(`/api/agenda/${id}`, visitorToken);
  assert.deepEqual(after.json().event.mine, { attendance: 'online', paid: false });
});

test('closed events and past days refuse registrations', async () => {
  const closed = await send('POST', '/api/admin/agenda', { title: 'فعالية مقفولة', date: soon, mode: 'both', open: false }, adminToken);
  assert.equal((await send('POST', `/api/agenda/${closed.json().event.id}/register`, { attendance: 'hq' }, memberToken)).statusCode, 409);

  const past = await send('POST', '/api/admin/agenda', { title: 'فعالية فاتت', date: '2026-01-01', mode: 'both', open: true }, adminToken);
  assert.equal((await send('POST', `/api/agenda/${past.json().event.id}/register`, { attendance: 'hq' }, memberToken)).statusCode, 409);
  // Owner (2026-10-23): a finished event NEVER leaves the public agenda, however old — flagged `past`.
  const pub = await get('/api/agenda');
  const old = (pub.json().events as { id: string; past: boolean }[]).find((entry) => entry.id === past.json().event.id);
  assert.equal(old?.past, true);

  // M77 (owner): a RECENTLY finished event stays listed — flagged `past`, closed, and AFTER the upcoming ones.
  const recentDay = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  const recent = await send('POST', '/api/admin/agenda', { title: 'ورشة انتهت للتو', date: recentDay, mode: 'both', open: true }, adminToken);
  const listed = (await get('/api/agenda')).json().events as { id: string; past: boolean; open: boolean }[];
  const entry = listed.find((item) => item.id === recent.json().event.id);
  assert.ok(entry, 'the recent past event is listed');
  assert.equal(entry?.past, true);
  assert.equal(entry?.open, false);
  assert.ok(listed.filter((item) => !item.past).every((item) => listed.indexOf(item) < listed.indexOf(entry as (typeof listed)[0])), 'upcoming events come first');
  assert.equal((await send('POST', `/api/agenda/${recent.json().event.id}/register`, { attendance: 'hq' }, memberToken)).statusCode, 409);
  await send('DELETE', `/api/admin/agenda/${recent.json().event.id}`, undefined, adminToken);
});

test('the dashboard sees counts and the registrations of an event, and can edit and delete', async () => {
  const listed = await get('/api/admin/agenda', adminToken);
  const row = (listed.json().events as { id: string; counts: { confirmed: number; hq: number; online: number } }[]).find((entry) => entry.id === feeEventId);
  assert.equal(row?.counts.confirmed, 2);
  assert.equal(row?.counts.hq, 1);
  assert.equal(row?.counts.online, 1);

  const rows = await get(`/api/admin/agenda/${feeEventId}/registrations`, adminToken);
  assert.equal((rows.json().registrations as { paid: boolean }[]).length, 2);

  const updated = await send('PUT', `/api/admin/agenda/${feeEventId}`, { feeSar: 200 }, adminToken);
  assert.equal(updated.json().event.feeSar, 200);

  const noDevices = await send('POST', `/api/admin/agenda/${feeEventId}/notify`, undefined, adminToken);
  assert.equal(noDevices.statusCode, 409);

  const removed = await send('DELETE', `/api/admin/agenda/${feeEventId}`, undefined, adminToken);
  assert.equal(removed.statusCode, 200);
  assert.equal((await get(`/api/admin/agenda/${feeEventId}/registrations`, adminToken)).json().registrations.length, 0);
});

// M70: a workshop runs over several hand-picked days with one time for all of them.
test('multi-day workshops: days are normalized, the agenda keeps them until the last day, one-day lists collapse', async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
  // Hand-picked, unsorted, with a duplicate; the first day has already passed.
  const created = await send('POST', '/api/admin/agenda', { title: 'ورشة على ثلاثة أيام', date: soon, dates: [later, yesterday, soon, soon], time: '18:00', mode: 'both', feeSar: 0, open: true }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  const event = created.json().event;
  assert.deepEqual(event.dates, [yesterday, soon, later], 'sorted and deduped');
  assert.equal(event.date, yesterday, 'date mirrors the first day');

  // Still on the public agenda (the last day is ahead), and registration still opens mid-run.
  const agenda = await get('/api/agenda', memberToken);
  const shown = (agenda.json().events as { id: string; dates: string[] }[]).find((entry) => entry.id === event.id);
  assert.ok(shown, 'listed although the first day passed');
  assert.deepEqual(shown?.dates, [yesterday, soon, later]);
  const registered = await send('POST', `/api/agenda/${event.id}/register`, { attendance: 'online' }, memberToken);
  assert.equal(registered.statusCode, 201, registered.body);
  assert.equal(registered.json().registration.paid, true);

  // Collapsing to one day: the list leaves, the public payload still carries [date].
  const collapsed = await send('PUT', `/api/admin/agenda/${event.id}`, { dates: [soon] }, adminToken);
  assert.equal(collapsed.json().event.dates, undefined);
  assert.equal(collapsed.json().event.date, soon);
  const single = await get(`/api/agenda/${event.id}`, memberToken);
  assert.deepEqual(single.json().event.dates, [soon]);

  await send('DELETE', `/api/admin/agenda/${event.id}`, undefined, adminToken);
});
