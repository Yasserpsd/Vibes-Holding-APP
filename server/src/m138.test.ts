import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import type { MemberRequest } from './requests/model.js';
import { MemoryKV } from './store.js';

// M138: a receipt mail for every member action, mail + push on every status change, and the
// «متابعة طلباتي» timeline (GET /api/me/requests) over every store.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com', PUBLIC_URL: 'https://api.test' });

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
let adminToken = '';
let cardId = '';
let serviceId = '';

const MEMBER_MAIL = 'm138+member@gmail.com';
const bearer = (token?: string, lang?: string) => ({ ...(token ? { authorization: `Bearer ${token}` } : {}), ...(lang ? { 'x-app-lang': lang } : {}) });
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown> | undefined, token?: string, lang?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token, lang) });

/** The last mail the member himself got (the admin copies go to NOTIFY_EMAIL). */
const memberMails = () => mailer.sent.filter((mail) => mail.to.includes(MEMBER_MAIL));

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', {
    name: 'سارة العتيبي',
    country: 'sa',
    phone,
    email,
    password: 'secret123',
    persona: 'investor',
    jobTitle: 'مديرة استثمار',
    bio: 'حساب اختبار متابعة الطلبات والإيصالات.',
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  const member = await signUp(MEMBER_MAIL, '0558618811');
  memberToken = member.token;
  hub.members.add(member.id);
  await get('/api/me?fresh=1', memberToken);
  adminToken = (await signUp('m138.admin@gmail.com', '0558618812')).token;
});

after(async () => {
  await app.close();
});

test('a card delivery request mails the member a royal no-fee receipt at once', async () => {
  const before = memberMails().length;
  const created = await send('POST', '/api/card/print', { city: 'الرياض', address: 'حي الياسمين، شارع الأمير', note: 'اتصل قبل التوصيل' }, memberToken);
  assert.equal(created.statusCode, 201, created.body);
  cardId = created.json().request.id as string;
  const mails = memberMails();
  assert.equal(mails.length, before + 1);
  const receipt = mails.at(-1)!;
  assert.match(receipt.subject, /إيصال طلب توصيل كارت العضوية/);
  assert.match(receipt.text, /بدون رسوم/);
  assert.doesNotMatch(receipt.text, /0\.00/);
  assert.match(receipt.html ?? '', /#0d274a/i);
  assert.match(receipt.text, /حي الياسمين/);
  // The admin mail is untouched: still the plain management notice.
  const admin = mailer.sent.filter((mail) => mail.to.includes('admin@vcmem.com')).at(-1)!;
  assert.match(admin.subject, /طلب طباعة كارت العضوية/);
});

test('a service request lands on the ledger with a receipt, in the app language', async () => {
  const before = memberMails().length;
  const ok = await send('POST', '/api/services/studio/request', { answers: { package: 'الكاملة', time: 'الثلاثاء 4 عصرًا' } }, memberToken, 'en');
  assert.equal(ok.statusCode, 200, ok.body);
  const mails = memberMails();
  assert.equal(mails.length, before + 1);
  assert.match(mails.at(-1)!.subject, /We received your request — Service request/);
  assert.match(mails.at(-1)!.text, /Track my requests/);
  const ledger = await get('/api/admin/requests', adminToken);
  assert.equal(ledger.statusCode, 200, ledger.body);
  const entries = ledger.json().requests as { id: string; kind: string; status: string; title: string; lang: string }[];
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.kind, 'service');
  assert.equal(entries[0]!.status, 'pending');
  assert.equal(entries[0]!.lang, 'en');
  serviceId = entries[0]!.id;
});

test('GET /api/me/requests is the member’s own timeline, newest first, never cached', async () => {
  const response = await get('/api/me/requests', memberToken);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  const requests = response.json().requests as MemberRequest[];
  assert.deepEqual(
    requests.map((entry) => entry.kind),
    ['service', 'card'],
  );
  const card = requests.find((entry) => entry.kind === 'card')!;
  assert.equal(card.status, 'pending');
  assert.equal(card.noFee, true);
  assert.equal(card.number.length, 8);
  assert.equal(card.screen, '/card');
  assert.ok(card.rows.some((row) => row.value === 'الرياض'));
  const service = requests.find((entry) => entry.kind === 'service')!;
  assert.equal(service.screen, '/service/studio');
  assert.ok(service.rows.some((row) => row.value === 'الكاملة'));
  // A guest sees nothing; another account sees its own (empty) timeline.
  assert.equal((await get('/api/me/requests')).statusCode, 401);
  assert.deepEqual((await get('/api/me/requests', adminToken)).json().requests, []);
});

test('the dashboard moves a card request along and the member is mailed on every real change', async () => {
  const before = memberMails().length;
  const progress = await send('POST', `/api/admin/card-requests/${cardId}/status`, { status: 'in_progress', note: 'الكارت في الطباعة' }, adminToken);
  assert.equal(progress.statusCode, 200, progress.body);
  assert.equal(progress.json().request.status, 'in_progress');
  let mails = memberMails();
  assert.equal(mails.length, before + 1);
  assert.match(mails.at(-1)!.subject, /طلبك جارٍ تنفيذه/);
  assert.match(mails.at(-1)!.text, /الكارت في الطباعة/);
  // The same status again changes nothing and mails nothing.
  await send('POST', `/api/admin/card-requests/${cardId}/status`, { status: 'in_progress' }, adminToken);
  assert.equal(memberMails().length, before + 1);
  // The old «تم التسليم» button still works and reads as done.
  const done = await send('POST', `/api/admin/card-requests/${cardId}/done`, undefined, adminToken);
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().request.status, 'done');
  mails = memberMails();
  assert.equal(mails.length, before + 2);
  assert.match(mails.at(-1)!.subject, /تم تنفيذ طلبك/);
  const timeline = (await get('/api/me/requests', memberToken)).json().requests as MemberRequest[];
  assert.equal(timeline.find((entry) => entry.kind === 'card')?.status, 'done');
  // Members never reach the control.
  assert.equal((await send('POST', `/api/admin/card-requests/${cardId}/status`, { status: 'done' }, memberToken)).statusCode, 403);
});

test('the ledger entries take the same control, in the member’s language', async () => {
  const before = memberMails().length;
  const rejected = await send('POST', `/api/admin/requests/${serviceId}/status`, { status: 'rejected', note: 'The slot is fully booked' }, adminToken);
  assert.equal(rejected.statusCode, 200, rejected.body);
  const mails = memberMails();
  assert.equal(mails.length, before + 1);
  assert.match(mails.at(-1)!.subject, /Your request could not be completed/);
  assert.match(mails.at(-1)!.text, /The slot is fully booked/);
  const timeline = (await get('/api/me/requests', memberToken)).json().requests as MemberRequest[];
  assert.equal(timeline.find((entry) => entry.kind === 'service')?.status, 'rejected');
  assert.equal(timeline.find((entry) => entry.kind === 'service')?.note, 'The slot is fully booked');
  assert.equal((await send('POST', `/api/admin/requests/${serviceId}/status`, { status: 'weird' }, adminToken)).statusCode, 400);
  assert.equal((await send('POST', `/api/admin/requests/00000000-0000-4000-8000-000000000000/status`, { status: 'done' }, adminToken)).statusCode, 404);
});

test('a workshop registration gets a receipt and, at last, a status', async () => {
  const guide = await get('/api/guide');
  const workshop = (guide.json().workshops.items as { id: string; open: boolean }[]).find((item) => item.open);
  assert.ok(workshop, 'the mock guide has an open workshop');
  const before = memberMails().length;
  const registered = await send('POST', '/api/workshops/register', { workshopId: workshop.id, note: 'أفضّل الفترة المسائية' }, memberToken);
  assert.equal(registered.statusCode, 201, registered.body);
  assert.equal(memberMails().length, before + 1);
  assert.match(memberMails().at(-1)!.subject, /التسجيل في ورشة/);
  const id = registered.json().registration.id as string;
  const done = await send('POST', `/api/admin/workshops/${id}/status`, { status: 'done' }, adminToken);
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().registration.status, 'done');
  assert.equal(memberMails().length, before + 2);
  const timeline = (await get('/api/me/requests', memberToken)).json().requests as MemberRequest[];
  assert.equal(timeline.find((entry) => entry.kind === 'workshop')?.status, 'done');
  assert.equal(timeline[0]?.kind, 'workshop');
});
