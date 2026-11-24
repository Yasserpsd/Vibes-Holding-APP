import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { toMe } from './auth/service.js';
import { loadConfig } from './config.js';
import { AUDIT_KEY, type AuditEntry } from './dashboard/service.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { HubError, type HubBody, type HubClient, type HubContact, type HubOp, type HubResponse } from './hub/types.js';
import { DAY_MS } from './riyadh.js';
import { MemoryKV } from './store.js';
import { googleClaims, googleObjectId } from './wallet/google.js';
import { passJson } from './wallet/pkpass.js';

/** The mock hub (it speaks 2.33.0's partner actions); it can demote an admin or pose as a real hub before 2.33.0. */
class StagedHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly calls: { op: HubOp; body: HubBody }[] = [];
  readonly demoted = new Set<number>();
  /** A real version string makes the hub refuse the partner actions the way 2.32.0 does. */
  oldVersion: string | null = null;

  constructor(readonly inner = new MockHubClient({ seed: true })) {}

  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    this.calls.push({ op, body });
    if (this.oldVersion && op === 'ping') return { ok: true, version: this.oldVersion } as unknown as HubResponse;
    if (this.oldVersion && op === 'admin_grant' && String(body.action).startsWith('partner')) throw new HubError('invalid', 'بيانات ناقصة', 400);
    const result = await this.inner.call(op, body);
    if (result.contact && this.demoted.has(result.contact.id)) result.contact.is_admin = 0;
    return result;
  }
}

const WEBHOOK = 'test-webhook-secret-271';
const kv = new MemoryKV();
const hub = new StagedHub();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', REVENUECAT_WEBHOOK_AUTH: WEBHOOK });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let adminToken = '';
let caller = 0;

type Inject = { method: 'GET' | 'POST'; url: string; payload?: Record<string, unknown>; token?: string; headers?: Record<string, string> };
const call = (input: Inject) => {
  caller += 1;
  return app.inject({ method: input.method, url: input.url, ...(input.payload ? { payload: input.payload } : {}), remoteAddress: `10.71.0.${(caller % 250) + 1}`, headers: { ...(input.token ? { authorization: `Bearer ${input.token}` } : {}), ...input.headers } });
};
const post = (url: string, payload: Record<string, unknown>, token?: string, headers?: Record<string, string>) => call({ method: 'POST', url, payload, token, headers });
const get = (url: string, token?: string) => call({ method: 'GET', url, token });
const partner = (id: number, on: boolean, token = adminToken, extra: Record<string, unknown> = {}) => post(`/api/admin/accounts/${id}/partner`, { on, note: '', confirm: true, ...extra }, token);
const honorary = (id: number, on: boolean) => post(`/api/admin/accounts/${id}/honorary`, { on, note: '', confirm: true }, adminToken);
const grant = (id: number, action: 'activate' | 'extend' | 'revoke', days = 30) => post(`/api/admin/accounts/${id}/grant`, { action, days, note: 'اختبار', confirm: true }, adminToken);
type MembershipView = { status: string; kind: string; daysLeft: number | null; endDate: string | null };
const membershipOf = async (token: string) => (await get('/api/me?fresh=1', token)).json().me.membership as MembershipView;

let phone = 8327100;
async function signUp(email: string, extra: Record<string, unknown> = {}): Promise<{ token: string; id: number }> {
  phone += 1;
  const registered = await post('/api/auth/register', { name: 'سلطان العتيبي', country: 'sa', phone: `055${phone}`, email, password: 'secret123', persona: 'entrepreneur', bio: 'حساب لاختبار عضوية شركاء النجاح.', ...extra });
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
  adminToken = (await signUp('m271.admin@gmail.com')).token;
});

after(async () => {
  await app.close();
});

test('only a dashboard admin gives the Success Partners membership, and only with confirm', async () => {
  const member = await signUp('m271.plain@gmail.com');
  assert.equal((await post(`/api/admin/accounts/${member.id}/partner`, { on: true, confirm: true })).statusCode, 401);

  const other = await signUp('m271.notadmin@gmail.com');
  hub.demoted.add(other.id);
  assert.equal((await get('/api/me?fresh=1', other.token)).json().me.isAdmin, false);
  // Neither for somebody else nor for himself.
  assert.equal((await partner(member.id, true, other.token)).statusCode, 403);
  assert.equal((await partner(other.id, true, other.token)).statusCode, 403);

  assert.equal((await post(`/api/admin/accounts/${member.id}/partner`, { on: true }, adminToken)).statusCode, 400);
  assert.equal((await partner(member.id, true, adminToken, { days: 30 })).statusCode, 400, 'the length is the hub\'s: no days are taken');
  assert.equal(hub.calls.filter((entry) => entry.op === 'admin_grant').length, 0, 'nothing reached the hub');
  assert.equal((await membershipOf(member.token)).kind, 'annual');
});

test('nothing the app sends can set it', async () => {
  const sneaky = await signUp('m271.sneaky@gmail.com', { partner: 1, kind: 'partner', membership: { kind: 'partner' } });
  const membership = await membershipOf(sneaky.token);
  assert.equal(membership.kind, 'annual');
  assert.equal(membership.status, 'unactivated');
});

test('a grant gives 360 days with an end date; it is audited, and it is never offered twice', async () => {
  const member = await signUp('m271.grant@gmail.com');
  const given = await partner(member.id, true);
  assert.equal(given.statusCode, 200, given.body);
  assert.equal(given.json().contact.partner, 1);
  assert.equal(given.json().event.kind, 'partner');

  const membership = await membershipOf(member.token);
  assert.equal(membership.status, 'active');
  assert.equal(membership.kind, 'partner');
  assert.equal(membership.daysLeft, 360);
  assert.equal(membership.endDate, given.json().contact.partner_end);

  const audit = ((await kv.get<{ entries: AuditEntry[] }>(AUDIT_KEY))?.entries ?? []).find((entry) => entry.contactId === member.id && entry.result === 'ok');
  assert.equal(audit?.action, 'partner');
  assert.equal(audit?.note, 'منح عضوية شركاء النجاح لمدة 360 يومًا', 'an empty note writes itself');

  assert.ok((await partner(member.id, true)).statusCode >= 400);
  // While it runs, the ordinary actions and the honorary grant are refused with their own codes.
  for (const action of ['activate', 'extend', 'revoke'] as const) {
    const refused = await grant(member.id, action);
    assert.equal(refused.statusCode, 409, refused.body);
    assert.equal(refused.json().error.code, 'partner');
  }
  assert.equal((await honorary(member.id, true)).json().error.code, 'partner');

  // The dashboard's member sheet reads the same fields.
  const sheet = await get('/api/admin/accounts/' + member.id, adminToken);
  assert.equal(sheet.statusCode, 200, sheet.body);
  assert.equal(sheet.json().account.partner, 1);
  assert.equal(sheet.json().account.partner_left, 360);
});

test('a revoke ends it; a paid period that was running is the member\'s again', async () => {
  const member = await signUp('m271.paid@gmail.com');
  assert.equal((await grant(member.id, 'activate', 100)).statusCode, 200);
  assert.equal((await partner(member.id, true)).statusCode, 200);
  assert.equal((await membershipOf(member.token)).daysLeft, 360);

  const taken = await partner(member.id, false);
  assert.equal(taken.statusCode, 200, taken.body);
  assert.equal(taken.json().event.kind, 'partner_revoked');
  const membership = await membershipOf(member.token);
  assert.equal(membership.kind, 'annual');
  assert.equal(membership.status, 'active');
  assert.equal(membership.daysLeft, 100);

  const never = await signUp('m271.never@gmail.com');
  assert.equal((await partner(never.id, true)).statusCode, 200);
  assert.equal((await partner(never.id, false)).statusCode, 200);
  assert.equal((await membershipOf(never.token)).status, 'unactivated');
});

test('a store purchase during the year is kept: the card stays partner, the paid year is there after a revoke', async () => {
  const member = await signUp('m271.buys@gmail.com');
  assert.equal((await partner(member.id, true)).statusCode, 200);
  assert.equal((await purchase('E-271-1', member.id)).statusCode, 200);
  const during = await membershipOf(member.token);
  assert.equal(during.kind, 'partner');
  assert.equal(during.daysLeft, 360, 'the card shows the partner year, not the bought one');
  assert.equal((await partner(member.id, false)).statusCode, 200);
  const after = await membershipOf(member.token);
  assert.equal(after.kind, 'annual');
  assert.equal(after.status, 'active');
  assert.ok((after.daysLeft ?? 0) >= 364, String(after.daysLeft));
});

test('after the year it reads as an ended membership, with no job having run', async () => {
  const member = await signUp('m271.lapse@gmail.com');
  assert.equal((await partner(member.id, true)).statusCode, 200);
  const contact = (hub.inner as unknown as { contacts: Map<number, { partnerAt: number }> }).contacts.get(member.id);
  assert.ok(contact);
  contact.partnerAt -= 361 * DAY_MS;
  const membership = await membershipOf(member.token);
  assert.equal(membership.kind, 'annual');
  assert.equal(membership.status, 'expired');
  // It can be given again for a new year.
  assert.equal((await partner(member.id, true)).statusCode, 200);
  assert.equal((await membershipOf(member.token)).daysLeft, 360);
});

test('an honorary member cannot be given it until the honorary one is taken back', async () => {
  const member = await signUp('m271.hon@gmail.com');
  assert.equal((await honorary(member.id, true)).statusCode, 200);
  const refused = await partner(member.id, true);
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().error.code, 'honorary');
  assert.equal((await membershipOf(member.token)).kind, 'honorary');
  assert.equal((await honorary(member.id, false)).statusCode, 200);
  assert.equal((await partner(member.id, true)).statusCode, 200);
  assert.equal((await membershipOf(member.token)).kind, 'partner');
});

test('a hub before 2.33.0 changes nothing and the admin is told to update it', async () => {
  // A separate app: the hub's version is remembered for a few minutes, so the old hub needs its own memory of it.
  const oldHub = new StagedHub();
  oldHub.oldVersion = '2.32.0';
  const main = app;
  app = (await buildApp({ config, kv: new MemoryKV(), hub: oldHub })).app;
  try {
    const admin = await signUp('m271.oldadmin@gmail.com');
    const member = await signUp('m271.oldhub@gmail.com');
    const refused = await partner(member.id, true, admin.token);
    assert.equal(refused.statusCode, 501, refused.body);
    assert.equal(refused.json().error.code, 'hub_not_supported');
    assert.match(refused.json().error.message, /2.33.0/);
    assert.equal((await membershipOf(member.token)).kind, 'annual');
  } finally {
    await app.close();
    app = main;
  }
});

test('a hub that knows nothing of the kind still draws the annual and the honorary memberships', () => {
  const old = { id: 7, name: 'سلطان العتيبي', email: 'a@b.co', phone: '', stage: 2, is_member: 1, member_left: 40, member_days: 360, member_end: '2027-01-01', member_expired: 0, daily_limit: 30, daily_left: 30, has_account: 1, verified: 1, role: 'member', is_admin: 0, job_title: '', persona: 'investor', website: '', social: '', avatar: '', company: '', member_type: '', city: '', bio: '', pending_pay: 0 } as unknown as HubContact;
  assert.deepEqual({ kind: toMe(old).membership.kind, daysLeft: toMe(old).membership.daysLeft, endDate: toMe(old).membership.endDate }, { kind: 'annual', daysLeft: 40, endDate: '2027-01-01' });
  const honoraryOld = { ...old, honorary: 1 as const, member_left: null, member_end: '' };
  assert.equal(toMe(honoraryOld).membership.kind, 'honorary');
  // And a partner's own dates win over the later paid end.
  const partnered = { ...old, member_left: 500, member_end: '2028-04-01', partner: 1 as const, partner_left: 200, partner_end: '2027-06-13' };
  assert.deepEqual({ kind: toMe(partnered).membership.kind, daysLeft: toMe(partnered).membership.daysLeft, endDate: toMe(partnered).membership.endDate }, { kind: 'partner', daysLeft: 200, endDate: '2027-06-13' });
});

test('the wallet passes wear the three colours, and only the Success Partners one carries its logo', () => {
  const member = { name: 'سلطان العتيبي', cardNumber: 'E-0000000271', categoryAr: 'رائد الأعمال', categoryEn: 'Entrepreneur' };
  const credentials = { passTypeId: 'pass.example', teamId: 'TEAM' };
  const pass = (kind: 'annual' | 'partner' | 'honorary', endDate: string | null) => passJson(credentials, { ...member, kind, endDate }) as { backgroundColor: string; expirationDate?: string; generic: { secondaryFields: { value: string }[]; auxiliaryFields: { key: string; value: string }[] } };
  const faces = [pass('annual', '2027-11-20'), pass('partner', '2027-11-20'), pass('honorary', null)];
  assert.equal(new Set(faces.map((face) => face.backgroundColor)).size, 3);
  assert.equal(faces[0]?.backgroundColor, 'rgb(11, 10, 8)', 'the annual pass is the one it was');
  assert.equal(faces[1]?.generic.auxiliaryFields[0]?.value, 'Success Partners');
  assert.equal(faces[1]?.expirationDate, '2027-11-20T23:59:59Z');
  assert.equal(faces[2]?.generic.secondaryFields[1]?.value, 'Honorary membership');
  // A paid membership the administration opened with no end date is not called honorary.
  assert.equal(pass('annual', null).generic.secondaryFields[1]?.value, 'Active membership');

  const google = { issuerId: '33880000000', email: 'a@b.co', privateKeyPem: '' };
  type Claims = { payload: { genericObjects: { id: string; hexBackgroundColor: string; heroImage?: { sourceUri: { uri: string } }; subheader: { defaultValue: { value: string } } }[] } };
  const object = (kind: 'annual' | 'partner' | 'honorary') => (googleClaims(google, { ...member, kind, endDate: kind === 'honorary' ? null : '2027-11-20' }, 'https://x/emblem.png', 'ar', new Date(), 'https://x/partners.png') as Claims).payload.genericObjects[0]!;
  assert.deepEqual([object('annual').hexBackgroundColor, object('partner').hexBackgroundColor, object('honorary').hexBackgroundColor], ['#0B0A08', '#0D2E86', '#FBF8F0']);
  assert.equal(object('partner').heroImage?.sourceUri.uri, 'https://x/partners.png');
  assert.equal(object('annual').heroImage, undefined);
  assert.equal(object('partner').subheader.defaultValue.value, 'عضوية شركاء النجاح');
  // The annual object keeps the id of the passes already saved; the others are their own, so Google draws them anew.
  assert.equal(object('annual').id, googleObjectId(google.issuerId, member.cardNumber));
  assert.notEqual(object('partner').id, object('annual').id);
});
