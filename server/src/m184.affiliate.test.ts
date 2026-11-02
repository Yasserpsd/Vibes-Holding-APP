import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { AffiliateService, DEFAULT_AFFILIATE_CONFIG } from './affiliate/service.js';
import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubContact, HubOp, HubResponse } from './hub/types.js';
import { InvitesService } from './invites/service.js';
import { LogMailer } from './mail/mailer.js';
import { Notifier } from './mail/notify.js';
import { MemoryKV } from './store.js';

// M184: «برنامج ممثلي النادي» — the full-form application, the mailed agreement, the dashboard's
// approval as the only activation, hub-verified referrals, and the manual payout flow.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com', PUBLIC_URL: 'https://api-test.vibesholdingsa.com' });

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
let memberCode = '';
let adminToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

let nextPhone = 7714250;
const register = (email: string, extra: Record<string, unknown> = {}) =>
  send('POST', '/api/auth/register', {
    name: 'ممثل النادي',
    country: 'sa',
    phone: `055${(nextPhone += 1)}`,
    email,
    password: 'secret123',
    persona: 'neutral',
    bio: 'حساب اختبار لبرنامج ممثلي النادي.',
    ...extra,
  });

async function signUp(email: string, extra: Record<string, unknown> = {}): Promise<{ token: string; id: number }> {
  const registered = await register(email, extra);
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

const APPLY = {
  entityType: 'individual' as const,
  bankName: 'البنك الأهلي السعودي',
  accountName: 'ممثل النادي التجريبي',
  iban: 'SA44 2000 0001 2345 6789 1234',
  city: 'الرياض',
  address: 'حي العليا، شارع الأمير محمد بن عبدالعزيز',
  heardFrom: 'منصة إكس',
  heardFromNote: '',
};

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  const member = await signUp('m184+member@gmail.com', { persona: 'investor' });
  memberToken = member.token;
  memberId = member.id;
  hub.members.add(memberId);
  await get('/api/me?fresh=1', memberToken);
  memberCode = (await get('/api/me', memberToken)).json().me.cardNumber as string;
  adminToken = (await signUp('m184.admin@gmail.com')).token;
});

after(async () => {
  await app.close();
});

test('every signed-in account sees the program pitch, the agreement and the options', async () => {
  assert.equal((await get('/api/affiliate')).statusCode, 401);
  const mine = await get('/api/affiliate', memberToken);
  assert.equal(mine.statusCode, 200, mine.body);
  assert.equal(mine.json().status, 'none');
  assert.match(mine.json().agreementText as string, /250 ريال سعودي/);
  assert.match(mine.json().introText as string, /250 ريال سعودي/);
  assert.ok((mine.json().heardOptions as string[]).includes('عن طريق صديق'));
  assert.equal(mine.json().code, undefined);
});

test('the application needs the full form, and the agreement is mailed to the applicant', async () => {
  const badIban = await send('POST', '/api/affiliate/apply', { ...APPLY, iban: '12345' }, memberToken);
  assert.equal(badIban.statusCode, 400, badIban.body);

  const noEntity = await send('POST', '/api/affiliate/apply', { ...APPLY, entityType: 'team' }, memberToken);
  assert.equal(noEntity.statusCode, 400, noEntity.body);

  const badSource = await send('POST', '/api/affiliate/apply', { ...APPLY, heardFrom: 'مصدر غير موجود' }, memberToken);
  assert.equal(badSource.statusCode, 400, badSource.body);
  assert.equal(badSource.json().error.code, 'heard_from');

  const before = mailer.sent.length;
  const applied = await send('POST', '/api/affiliate/apply', APPLY, memberToken);
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(applied.json().application.status, 'agreement');
  // The IBAN is stored normalized (upper case, no spaces).
  assert.equal(applied.json().application.iban, 'SA4420000001234567891234');

  assert.equal(mailer.sent.length, before + 1);
  const mail = mailer.sent.at(-1);
  assert.deepEqual(mail?.to, ['m184+member@gmail.com']);
  assert.match(mail?.subject ?? '', /اتفاقية برنامج ممثلي/);
  assert.match(mail?.text ?? '', /لا يتحمّل النادي أي مسؤولية/);
  assert.match(mail?.text ?? '', /250 ريال سعودي/);
});

test('accepting the agreement sends the request to the administration — nothing activates itself', async () => {
  // The dashboard cannot approve before the applicant accepted the agreement.
  const early = await send('POST', `/api/admin/affiliates/${memberId}/decision`, { status: 'approved' }, adminToken);
  assert.equal(early.statusCode, 400, early.body);
  assert.equal(early.json().error.code, 'agreement_pending');

  const before = mailer.sent.length;
  const accepted = await send('POST', '/api/affiliate/agreement', {}, memberToken);
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().application.status, 'pending');
  assert.ok(accepted.json().application.agreementAcceptedAt);

  const mail = mailer.sent.at(-1);
  assert.equal(mailer.sent.length, before + 1);
  assert.match(mail?.subject ?? '', /طلب انضمام لبرنامج ممثلي النادي/);
  assert.match(mail?.text ?? '', /SA4420000001234567891234/);
  assert.match(mail?.text ?? '', /منصة إكس/);
  assert.match(mail?.text ?? '', /صفة مقدّم الطلب: فرد/);

  // Accepting twice changes nothing and sends no second mail.
  const again = await send('POST', '/api/affiliate/agreement', {}, memberToken);
  assert.equal(again.json().application.status, 'pending');
  assert.equal(mailer.sent.length, before + 1);

  // Still no referral link, and no payouts either.
  const mine = await get('/api/affiliate', memberToken);
  assert.equal(mine.json().status, 'pending');
  assert.equal(mine.json().code, undefined);
  assert.equal((await send('POST', '/api/affiliate/payout', { bankName: 'بنك', accountName: 'اسم صاحب الحساب', iban: 'SA4420000001234567891234' }, memberToken)).statusCode, 403);
});

test('the dashboard approval activates the affiliate and hands him his link', async () => {
  // The decision is the admins' alone.
  assert.equal((await send('POST', `/api/admin/affiliates/${memberId}/decision`, { status: 'approved' }, memberToken)).statusCode, 403);

  const before = mailer.sent.length;
  const approved = await send('POST', `/api/admin/affiliates/${memberId}/decision`, { status: 'approved' }, adminToken);
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().affiliate.status, 'approved');

  const mail = mailer.sent.at(-1);
  assert.equal(mailer.sent.length, before + 1);
  assert.deepEqual(mail?.to, ['m184+member@gmail.com']);
  assert.match(mail?.text ?? '', new RegExp(memberCode));

  const mine = await get('/api/affiliate', memberToken);
  assert.equal(mine.json().status, 'approved');
  assert.equal(mine.json().code, memberCode);
  assert.equal(mine.json().link, `https://api-test.vibesholdingsa.com/r/${encodeURIComponent(memberCode)}`);
  assert.ok((mine.json().shareText as string).includes(memberCode));
  assert.equal(mine.json().balance.available, 0);
  assert.equal(mine.json().balance.commission, 250);

  // No balance yet: the payout door stays shut.
  const payout = await send('POST', '/api/affiliate/payout', { bankName: 'بنك', accountName: 'اسم صاحب الحساب', iban: 'SA4420000001234567891234' }, memberToken);
  assert.equal(payout.statusCode, 400, payout.body);
  assert.equal(payout.json().error.code, 'no_balance');
});

test('the referral link page shows the code; an unknown code falls back to /app', async () => {
  const page = await get(`/r/${encodeURIComponent(memberCode)}`);
  assert.equal(page.statusCode, 200, page.body);
  assert.match(page.headers['content-type'] as string, /text\/html/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.ok(page.body.includes(memberCode));
  assert.ok(page.body.includes('كود الدعوة'));

  const unknown = await get('/r/I-0009999999');
  assert.equal(unknown.statusCode, 302);
  assert.equal(unknown.headers.location, '/app');
});

test('a registration through the code shows in the panel as an unpaid member', async () => {
  const registered = await register('m184.referral@gmail.com', { inviteCode: memberCode, name: 'عضو محال' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);

  const mine = await get('/api/affiliate', memberToken);
  const referrals = mine.json().referrals as { name: string; paid: boolean }[];
  assert.equal(referrals.length, 1);
  assert.equal(referrals[0]?.paid, false);
  assert.equal(mine.json().balance.referrals, 1);
  assert.equal(mine.json().balance.unpaid, 1);
  assert.equal(mine.json().balance.available, 0);

  // The dashboard sees the affiliate with his stats.
  const list = await get('/api/admin/affiliates', adminToken);
  assert.equal(list.statusCode, 200, list.body);
  assert.equal((await get('/api/admin/affiliates', memberToken)).statusCode, 403);
  const row = (list.json().affiliates as { contactId: number; status: string; stats: { referrals: number; paid: number } }[]).find((entry) => entry.contactId === memberId);
  assert.ok(row);
  assert.equal(row.status, 'approved');
  assert.equal(row.stats.referrals, 1);
  assert.equal(row.stats.paid, 0);
});

test('the owner edits the program content from the dashboard', async () => {
  const saved = await send(
    'POST',
    '/api/admin/affiliates/config',
    { commission: 300, heardOptions: ['منصة إكس', 'عن طريق صديق', 'أخرى'], shareText: 'سجّل من رابطي {link} بالرمز {code}.' },
    adminToken,
  );
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().config.commission, 300);

  const mine = await get('/api/affiliate', memberToken);
  assert.equal(mine.json().balance.commission, 300);
  assert.match(mine.json().introText as string, /300 ريال سعودي/);
  assert.equal(mine.json().heardOptions.length, 3);
  assert.equal(mine.json().shareText, `سجّل من رابطي https://api-test.vibesholdingsa.com/r/${encodeURIComponent(memberCode)} بالرمز ${memberCode}.`);

  // Back to the default commission for the tests after this one.
  await send('POST', '/api/admin/affiliates/config', { commission: 250 }, adminToken);
});

test('a paid referral earns the commission and the payout runs its manual course', async () => {
  const kv = new MemoryKV();
  const payoutMailer = new LogMailer();
  const notifier = new Notifier({ mailer: payoutMailer, recipients: ['admin@vcmem.com'], log: built.app.log, appEnv: 'test' });
  const invites = new InvitesService({ kv, hub, notifier, log: built.app.log });
  const service = new AffiliateService({ kv, invites, notifier, log: built.app.log, publicUrl: 'https://api-test.vibesholdingsa.com' });

  const member = { contactId: 70, name: 'ممثل مستقل', email: 'rep@gmail.com', phone: '0550001111', code: 'N-0000000070' };
  await service.apply(member, { ...APPLY, iban: 'SA4420000001234567891234' });
  await service.acceptAgreement(70);
  await service.decide(70, 'approved', '', 'الإدارة');

  // Two hub-verified registrations through his code; one went on and PAID (server-confirmed activation).
  const invitee = (id: number, name: string) => ({ id, name, phone: '055', email: `${id}@gmail.com` }) as unknown as HubContact;
  await invites.recordFromRegister(invitee(71, 'عضو دافع'), 70, member.name, member.code);
  await invites.recordFromRegister(invitee(72, 'عضو غير دافع'), 70, member.name, member.code);
  await invites.onActivated(71);

  const balance = await service.balance(70);
  assert.equal(balance.paid, 1);
  assert.equal(balance.unpaid, 1);
  assert.equal(balance.earned, 250);
  assert.equal(balance.available, 250);
  const referrals = await service.referrals(70);
  assert.deepEqual(referrals.map((person) => person.paid).sort(), [false, true]);

  // «سحب الأرباح»: the full balance, one open request at a time, the administration mailed.
  const payout = await service.requestPayout(70, { bankName: 'البنك الأهلي', accountName: 'ممثل مستقل', iban: 'SA4420000001234567891234' });
  assert.equal(payout.amount, 250);
  assert.match(payoutMailer.sent.at(-1)?.subject ?? '', /طلب سحب أرباح/);
  await assert.rejects(service.requestPayout(70, { bankName: 'ب', accountName: 'ا', iban: 'SA1' }), /قيد المراجعة/);
  assert.equal((await service.balance(70)).available, 0);

  // Marked paid in the dashboard → the affiliate is mailed; the balance stays withdrawn.
  const done = await service.decidePayout(payout.id, 'paid', 'حوالة بنكية', 'الإدارة');
  assert.equal(done?.status, 'paid');
  assert.match(payoutMailer.sent.at(-1)?.subject ?? '', /تم تحويل أرباحك/);
  assert.equal((await service.balance(70)).available, 0);
  assert.equal((await service.decidePayout(payout.id, 'paid', '', 'الإدارة')), null);

  // The second referral pays too: new balance. A rejected payout releases its amount back.
  await invites.onActivated(72);
  assert.equal((await service.balance(70)).available, 250);
  const second = await service.requestPayout(70, { bankName: 'البنك الأهلي', accountName: 'ممثل مستقل', iban: 'SA4420000001234567891234' });
  assert.equal((await service.balance(70)).available, 0);
  await service.decidePayout(second.id, 'rejected', 'راجع بيانات الحساب', 'الإدارة');
  assert.equal((await service.balance(70)).available, 250);
});

test('a rejected application can be sent again; the config falls back whole', async () => {
  const kv = new MemoryKV();
  const notifier = new Notifier({ mailer: new LogMailer(), recipients: [], log: built.app.log, appEnv: 'test' });
  const invites = new InvitesService({ kv, hub, notifier, log: built.app.log });
  const service = new AffiliateService({ kv, invites, notifier, log: built.app.log, publicUrl: '' });

  assert.deepEqual(await service.config(), DEFAULT_AFFILIATE_CONFIG);

  const member = { contactId: 80, name: 'متقدم', email: 'a80@gmail.com', phone: '055', code: 'N-0000000080' };
  await service.apply(member, APPLY);
  await service.acceptAgreement(80);
  await service.decide(80, 'rejected', 'بيانات غير مكتملة', 'الإدارة');
  assert.equal((await service.find(80))?.status, 'rejected');

  // Applying again restarts from the agreement step.
  const again = await service.apply(member, APPLY);
  assert.equal(again.status, 'agreement');
  assert.equal(again.agreementAcceptedAt, null);

  // While approved or pending, a second application is refused.
  await service.acceptAgreement(80);
  await assert.rejects(service.apply(member, APPLY), /قيد مراجعة/);
});
