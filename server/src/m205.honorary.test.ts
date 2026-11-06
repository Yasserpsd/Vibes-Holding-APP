import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { toMe } from './auth/service.js';
import { loadConfig } from './config.js';
import { AUDIT_KEY, type AuditEntry } from './dashboard/service.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { HubError, type HubBody, type HubClient, type HubContact, type HubOp, type HubResponse } from './hub/types.js';
import { honoraryPeriod, pbPeriodOf } from './membership/honorary.js';
import { pbMemberOf } from './projectsBank/access.js';
import { DAY_MS, riyadhDay } from './riyadh.js';
import { MemoryKV } from './store.js';
import { fallbackMail } from './whatsapp/service.js';
import { buildBodyParams, TEMPLATE_NAMES } from './whatsapp/templates.js';

/** The mock hub (it speaks 2.28.0's honorary actions); it can demote an admin or pose as a real hub before 2.28.0. */
class StagedHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly calls: { op: HubOp; body: HubBody }[] = [];
  readonly demoted = new Set<number>();
  /** A real version string makes the hub refuse the honorary actions the way 2.27.1 does. */
  oldVersion: string | null = null;

  constructor(readonly inner = new MockHubClient({ seed: true })) {}

  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    this.calls.push({ op, body });
    if (this.oldVersion && op === 'ping') return { ok: true, version: this.oldVersion } as unknown as HubResponse;
    if (this.oldVersion && op === 'admin_grant' && String(body.action).startsWith('honorary')) throw new HubError('invalid', 'إجراء غير معروف', 400);
    const result = await this.inner.call(op, body);
    if (result.contact && this.demoted.has(result.contact.id)) result.contact.is_admin = 0;
    return result;
  }
}

const WEBHOOK = 'test-webhook-secret-205';
const kv = new MemoryKV();
const hub = new StagedHub();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', REVENUECAT_WEBHOOK_AUTH: WEBHOOK });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let adminToken = '';
let caller = 0;

type Inject = { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: Record<string, unknown>; token?: string; headers?: Record<string, string> };
const call = (target: typeof app, input: Inject) => {
  caller += 1;
  return target.inject({ method: input.method, url: input.url, ...(input.payload ? { payload: input.payload } : {}), remoteAddress: `10.5.0.${(caller % 250) + 1}`, headers: { ...(input.token ? { authorization: `Bearer ${input.token}` } : {}), ...input.headers } });
};
const post = (url: string, payload: Record<string, unknown>, token?: string, headers?: Record<string, string>) => call(app, { method: 'POST', url, payload, token, headers });
const get = (url: string, token?: string) => call(app, { method: 'GET', url, token });
const honorary = (id: number, on: boolean, token = adminToken, extra: Record<string, unknown> = {}) => post(`/api/admin/accounts/${id}/honorary`, { on, note: 'عضو مجلس إدارة Vibes Ventures', confirm: true, ...extra }, token);
const membershipOf = async (token: string) => (await get('/api/me?fresh=1', token)).json().me.membership as { status: string; kind: string; daysLeft: number | null; endDate: string | null };

let phone = 8318750;
async function signUp(email: string, extra: Record<string, unknown> = {}): Promise<{ token: string; id: number }> {
  phone += 1;
  const registered = await post('/api/auth/register', { name: 'سلطان العتيبي', country: 'sa', phone: `055${phone}`, email, password: 'secret123', persona: 'investor', bio: 'حساب لاختبار العضوية الشرفية.', ...extra });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

const purchase = (id: string, contactId: number, now = Date.now()) =>
  post(
    '/api/webhooks/revenuecat',
    { api_version: '1.0', event: { id, type: 'INITIAL_PURCHASE', app_user_id: `vc-${contactId}`, product_id: 'club_membership_annual', store: 'APP_STORE', environment: 'SANDBOX', purchased_at_ms: now, expiration_at_ms: now + 365 * DAY_MS, transaction_id: `T-${id}` } },
    undefined,
    { authorization: WEBHOOK },
  );

before(async () => {
  app = (await buildApp({ config, kv, hub })).app;
  adminToken = (await signUp('m205.admin@gmail.com')).token;
});

after(async () => {
  await app.close();
});

test('only a dashboard admin gives the honorary membership, and only with confirm', async () => {
  const member = await signUp('m205.plain@gmail.com');
  assert.equal((await post(`/api/admin/accounts/${member.id}/honorary`, { on: true, confirm: true })).statusCode, 401);

  const other = await signUp('m205.notadmin@gmail.com');
  hub.demoted.add(other.id);
  assert.equal((await get('/api/me?fresh=1', other.token)).json().me.isAdmin, false);
  // Neither for somebody else nor for himself.
  assert.equal((await honorary(member.id, true, other.token)).statusCode, 403);
  assert.equal((await honorary(other.id, true, other.token)).statusCode, 403);

  assert.equal((await post(`/api/admin/accounts/${member.id}/honorary`, { on: true }, adminToken)).statusCode, 400);
  assert.equal((await honorary(member.id, true, adminToken, { days: 30 })).statusCode, 400, 'an honorary membership takes no days');
  assert.equal(hub.calls.filter((entry) => entry.op === 'admin_grant').length, 0, 'nothing reached the hub');
  assert.deepEqual(await membershipOf(member.token), { ...(await membershipOf(member.token)), status: 'unactivated', kind: 'annual' });
});

test('nothing the app sends can set it', async () => {
  const sneaky = await signUp('m205.sneaky@gmail.com', { honorary: 1, kind: 'honorary', membership: { kind: 'honorary' } });
  const patched = await call(app, { method: 'PATCH', url: '/api/me', token: sneaky.token, payload: { city: 'الرياض', honorary: 1, kind: 'honorary', membership: { kind: 'honorary', status: 'active' } } });
  assert.ok(patched.statusCode === 200 || patched.statusCode === 400, patched.body);
  const membership = await membershipOf(sneaky.token);
  assert.equal(membership.kind, 'annual');
  assert.equal(membership.status, 'unactivated');
  for (const entry of hub.calls.filter((item) => item.op === 'register' || item.op === 'profile')) assert.equal('honorary' in entry.body, false, `${entry.op} never carries the flag`);
});

test('grant: full member at once, no days and no end date; the audit log keeps who did it', async () => {
  const member = await signUp('m205.board@gmail.com');
  const granted = await honorary(member.id, true, adminToken, { requestId: 'honorary-req-0001' });
  assert.equal(granted.statusCode, 200, granted.body);
  assert.equal(granted.json().contact.honorary, 1);
  assert.equal(granted.json().event.kind, 'honorary');
  assert.equal(granted.headers['cache-control'], 'no-store');

  assert.deepEqual(await membershipOf(member.token), { ...(await membershipOf(member.token)), status: 'active', kind: 'honorary', daysLeft: null, endDate: null });

  // A double tap replays the first answer; a second grant is refused by the hub.
  const again = await honorary(member.id, true, adminToken, { requestId: 'honorary-req-0001' });
  assert.equal(again.json().already, true);
  assert.equal((await honorary(member.id, true)).statusCode, 409);

  const account = (await get(`/api/admin/accounts/${member.id}`, adminToken)).json().account;
  assert.equal(account.state, 'member');
  assert.equal(account.honorary, 1);
  assert.equal(account.never_expires, 1);
  assert.equal((await get('/api/admin/home', adminToken)).json().hub.totals.members_honorary, 1);

  const audit = ((await kv.get<{ entries: AuditEntry[] }>(AUDIT_KEY))?.entries ?? []).filter((entry) => entry.action === 'honorary' && entry.contactId === member.id && entry.result === 'ok');
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0]?.params, { on: true });
  assert.equal(audit[0]?.note, 'عضو مجلس إدارة Vibes Ventures');

  // The ordinary membership buttons do not touch an honorary member.
  for (const action of ['activate', 'extend', 'revoke']) {
    const res = await post(`/api/admin/accounts/${member.id}/grant`, { action, days: 30, note: '', confirm: true }, adminToken);
    assert.equal(res.statusCode, 409, `${action} ${res.body}`);
    assert.equal(res.json().error.code, 'honorary');
  }
  assert.equal((await membershipOf(member.token)).kind, 'honorary');
});

test('no expiry: the flag wins over an expired paid clock, and a store purchase does not start one', async () => {
  // The server's own rule, whatever the paid fields under the flag say.
  const expired = { id: 9, name: 'سلطان العتيبي', email: 'x@example.com', phone: '', persona: 'investor', is_member: 0, member_expired: 1, member_left: 0, member_days: 365, member_end: '2020-01-01', honorary: 1, honorary_since: '2019-06-01', daily_limit: 20, daily_left: 20 } as unknown as HubContact;
  assert.deepEqual(toMe(expired).membership, { status: 'active', kind: 'honorary', daysLeft: null, endDate: null, aiDailyLimit: 20, aiDailyLeft: 20 });
  assert.equal(toMe({ ...expired, honorary: 0 }).membership.status, 'expired');
  assert.equal(toMe({ ...expired, honorary: undefined }).membership.kind, 'annual', 'a hub before 2.28.0 sends no flag');

  const member = await signUp('m205.subscriber@gmail.com');
  assert.equal((await honorary(member.id, true)).statusCode, 200);
  const bought = await purchase('m205-ev-1', member.id);
  assert.equal(bought.statusCode, 200, bought.body);
  assert.equal(bought.json().activation, 'activated');
  assert.deepEqual(await membershipOf(member.token), { ...(await membershipOf(member.token)), status: 'active', kind: 'honorary', daysLeft: null, endDate: null });

  // Taken back: the paid year he bought under it is his again, with its end date.
  const revoked = await honorary(member.id, false);
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal(revoked.json().event.kind, 'honorary_revoked');
  const paid = await membershipOf(member.token);
  assert.equal(paid.status, 'active');
  assert.equal(paid.kind, 'annual');
  assert.ok((paid.daysLeft ?? 0) > 360 && paid.endDate, 'the store year counts again');
});

test('revoke: a member with nothing paid under the flag is no longer a member', async () => {
  const member = await signUp('m205.revoked@gmail.com');
  assert.equal((await honorary(member.id, false)).statusCode, 409, 'nothing to take back yet');
  assert.equal((await honorary(member.id, true)).statusCode, 200);
  assert.equal((await membershipOf(member.token)).status, 'active');
  assert.equal((await honorary(member.id, false)).statusCode, 200);
  assert.deepEqual(await membershipOf(member.token), { ...(await membershipOf(member.token)), status: 'unactivated', kind: 'annual', daysLeft: null, endDate: null });
  assert.equal((await get(`/api/admin/accounts/${member.id}`, adminToken)).json().account.honorary, 0);
});

test('a hub before 2.28.0 changes nothing and the dashboard says why', async () => {
  const oldHub = new StagedHub(hub.inner);
  oldHub.oldVersion = '2.27.1';
  const old = (await buildApp({ config, kv, hub: oldHub })).app;
  const member = await signUp('m205.oldhub@gmail.com');
  const res = await call(old, { method: 'POST', url: `/api/admin/accounts/${member.id}/honorary`, token: adminToken, payload: { on: true, note: '', confirm: true } });
  assert.equal(res.statusCode, 501, res.body);
  assert.equal(res.json().error.code, 'hub_not_supported');
  assert.match(res.json().error.message, /2\.28\.0/);
  assert.equal((await membershipOf(member.token)).kind, 'annual');
  await old.close();
});

test('the Projects Bank year of an honorary member turns over every 365 days from the grant', () => {
  const now = Date.parse('2026-11-06T12:00:00+03:00');
  assert.deepEqual(honoraryPeriod('2026-11-06', now), { member_end: '2027-11-06', member_days: 365 });
  assert.deepEqual(honoraryPeriod('2025-03-01', now), { member_end: '2027-03-01', member_days: 365 });
  // No grant day (or one in the future): the calendar year.
  assert.deepEqual(honoraryPeriod('', now), { member_end: riyadhDay(Date.parse('2026-01-01T00:00:00+03:00') + 365 * DAY_MS), member_days: 365 });
  const paid = { member_end: '2027-01-15', member_days: 365 };
  assert.deepEqual(pbPeriodOf({ ...paid, honorary: 0 }, now), paid);
  const contact = { id: 7, name: 'سلطان العتيبي', email: 'x@example.com', phone: '0550000000', member_end: '', member_days: 0, honorary: 1, honorary_since: riyadhDay(Date.now()) } as unknown as HubContact;
  const member = pbMemberOf(contact);
  assert.equal(member.member_days, 365);
  assert.ok(member.member_end > riyadhDay(Date.now()), 'the bridge sees an active year');
});

test('grant and revoke each have their own WhatsApp template and the same words ready for e-mail', async () => {
  assert.equal(TEMPLATE_NAMES.honorary, 'club_honorary_membership');
  assert.equal(TEMPLATE_NAMES.honorary_ended, 'club_honorary_ended');
  assert.deepEqual(buildBodyParams('honorary', { name: 'سلطان' }, 'ar'), ['سلطان']);
  assert.deepEqual(buildBodyParams('honorary_ended', { name: '' }, 'en'), ['Member']);
  for (const kind of ['honorary', 'honorary_ended'] as const) {
    for (const lang of ['ar', 'en'] as const) {
      const mail = fallbackMail(kind, lang, { name: lang === 'ar' ? 'سلطان' : 'Sultan' });
      assert.ok(mail, `${kind} ${lang}`);
      // Owner (2026-11-06): both messages name the condition — an official partner in the founding contract.
      assert.match(mail.text, lang === 'ar' ? /(شريكًا رسميًا في عقد تأسيس|للشركاء الرسميين في عقود تأسيس)/ : /official partners? under the articles of association/);
      assert.match(mail.text, /Vibes Ventures/);
      assert.doesNotMatch(`${mail.subject} ${mail.text}`, /مجان|فايبز|فيبس/);
    }
  }
  // The templates filed with Meta say the same words as the e-mail copy.
  const filed = JSON.parse(await readFile(new URL('../../docs/whatsapp-template-honorary-m205.json', import.meta.url), 'utf8')) as { name: string; language: 'ar' | 'en'; body: string }[];
  assert.deepEqual(filed.map((entry) => `${entry.name}:${entry.language}`), ['club_honorary_membership:ar', 'club_honorary_membership:en', 'club_honorary_ended:ar', 'club_honorary_ended:en']);
  for (const entry of filed) {
    const kind = entry.name === 'club_honorary_ended' ? 'honorary_ended' : 'honorary';
    const mail = fallbackMail(kind, entry.language, { name: 'X' })?.text.replace(/\s+/g, ' ') ?? '';
    // The e-mail starts a new sentence after the greeting; the one-paragraph template does not.
    assert.equal(entry.body.replace('{{1}}', 'X').toLowerCase(), mail.toLowerCase(), `${entry.name} ${entry.language}`);
  }
});

test('the badge on a member page comes from the hub, for members only, and follows a revoke', async () => {
  const member = await signUp('m205.badge@gmail.com');
  const created = await post('/api/admin/profiles', { contactId: member.id, fields: { name: 'سلطان العتيبي', title: 'عضو مجلس الإدارة' } }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  const page = `/api/people/${created.json().profile.id}`;
  assert.equal((await get(page)).statusCode, 403, 'guests do not open the full page');
  assert.equal((await get(page, adminToken)).json().person.honorary, false);
  // The dashboard's grant and revoke drop the kept answer, so the badge follows at once.
  assert.equal((await honorary(member.id, true)).statusCode, 200);
  assert.equal((await get(page, adminToken)).json().person.honorary, true);
  assert.equal((await honorary(member.id, false)).statusCode, 200);
  assert.equal((await get(page, adminToken)).json().person.honorary, false);
  // The list (open to guests) never carries it.
  const listed = (await get('/api/people')).json().people.find((person: { name: string }) => person.name === 'سلطان العتيبي');
  assert.ok(listed && !('honorary' in listed));
});
