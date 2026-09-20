import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { AUDIT_KEY, type AuditEntry } from './dashboard/service.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { HubError, type HubBody, type HubClient, type HubOp, type HubResponse } from './hub/types.js';
import { MOCK_PB_VERSION, OffPbBridge } from './projectsBank/bridge.js';
import { MemoryKV } from './store.js';

/** The seeded mock hub; it can take the admin role away from one account or pose as a hub older than 2.7.0. */
class StagedHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly calls: { op: HubOp; body: HubBody }[] = [];
  readonly demoted = new Set<number>();
  old = false;
  /** How long `admin_grant` takes, to let a second tap arrive while the first is still on its way. */
  grantDelayMs = 0;
  readonly inner = new MockHubClient({ seed: true });

  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    this.calls.push({ op, body });
    if (this.old && /^(admin_|changes$|publish$|feed$)/.test(op)) throw new HubError('hub_not_supported', 'هذه الخدمة غير متاحة حاليًا', 501);
    if (op === 'admin_grant' && this.grantDelayMs) await new Promise((resolve) => setTimeout(resolve, this.grantDelayMs));
    const result = await this.inner.call(op, body);
    if (result.contact && this.demoted.has(result.contact.id)) result.contact.is_admin = 0;
    return result;
  }

  count(op: HubOp): number {
    return this.calls.filter((call) => call.op === op).length;
  }
}

/** Storage whose next writes of the audit log fail, as Postgres does when its connection drops. */
class AuditFailingKV extends MemoryKV {
  failAudit = 0;

  override async set(key: string, value: unknown): Promise<void> {
    if (key === AUDIT_KEY && this.failAudit > 0) {
      this.failAudit -= 1;
      throw new Error('connection terminated');
    }
    return super.set(key, value);
  }
}

const kv = new AuditFailingKV();
const hub = new StagedHub();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let adminToken = '';
let adminId = 0;
let caller = 0;

const post = (url: string, payload: Record<string, unknown>, token?: string) => {
  caller += 1;
  return app.inject({ method: 'POST', url, payload, remoteAddress: `10.1.0.${(caller % 250) + 1}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
};
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await post('/api/auth/register', { name: 'مدير اللوحة', country: 'sa', phone, email, password: 'secret123', persona: 'neutral', bio: 'حساب لاختبار لوحة الإدارة الموحدة.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

/** A seeded member of the demo club (active, with an end date). */
async function someMember(): Promise<{ id: number; member_left: number; pb: { left: number; used: number; granted: number } }> {
  const list = await get('/api/admin/accounts?state=member&per_page=100', adminToken);
  assert.equal(list.statusCode, 200, list.body);
  const member = list.json().items.find((item: { never_expires: number; member_left: number | null }) => item.never_expires === 0 && (item.member_left ?? 0) > 40);
  assert.ok(member, 'the demo club has an active member');
  return member;
}

before(async () => {
  app = (await buildApp({ config, kv, hub })).app;
  const admin = await signUp('m20.admin@gmail.com', '0558318701');
  adminToken = admin.token;
  adminId = admin.id;
});

after(async () => {
  await app.close();
});

const READS = ['/api/admin/home', '/api/admin/accounts', '/api/admin/accounts/1', '/api/admin/hub-payments', '/api/admin/tickets', '/api/admin/leads', '/api/admin/threads', '/api/admin/threads/1', '/api/admin/mail', '/api/admin/audit'];
const WRITES = ['/api/admin/accounts/1/grant', '/api/admin/accounts/1/role', '/api/admin/accounts/1/pb-grant', '/api/admin/threads/1/reply'];

test('every dashboard route needs a hub admin session and answers no-store', async () => {
  for (const url of READS) {
    const guest = await get(url);
    assert.equal(guest.statusCode, 401, url);
    assert.equal(guest.headers['cache-control'], 'no-store', url);
  }
  for (const url of WRITES) assert.equal((await post(url, { confirm: true })).statusCode, 401, url);

  const other = await signUp('m20.notadmin@gmail.com', '0558318702');
  hub.demoted.add(other.id);
  assert.equal((await get('/api/me?fresh=1', other.token)).json().me.isAdmin, false);
  for (const url of READS) assert.equal((await get(url, other.token)).statusCode, 403, url);
  for (const url of WRITES) assert.equal((await post(url, { confirm: true }, other.token)).statusCode, 403, url);

  for (const url of READS) {
    const res = await get(url, adminToken);
    assert.equal(res.statusCode, 200, `${url} ${res.body}`);
    assert.equal(res.headers['cache-control'], 'no-store', url);
  }
});

test('with ADMIN_OTP on, a session without the e-mailed code is refused', async () => {
  const guarded = (await buildApp({ config: loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', ADMIN_OTP: '1', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' }), kv, hub })).app;
  const res = await guarded.inject({ method: 'GET', url: '/api/admin/home', headers: { authorization: `Bearer ${adminToken}` } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'otp_required');
  await guarded.close();
});

test('home: hub stats with a zero-filled daily series, app payments, store, push and both bridge versions', async () => {
  const res = await get('/api/admin/home?days=14', adminToken);
  assert.equal(res.statusCode, 200, res.body);
  const home = res.json();
  assert.equal(home.hub.tz, 'Asia/Riyadh');
  assert.equal(home.hub.series.length, 14);
  assert.deepEqual(Object.keys(home.hub.series[0]), ['day', 'signups', 'verified', 'activations', 'renewals', 'payments_count', 'payments_cents', 'conversations', 'messages', 'leads']);
  assert.ok(home.hub.series[0].day < home.hub.series[13].day, 'oldest first');
  // The two accounts of this file registered today.
  assert.ok(home.hub.today.signups >= 2 && home.hub.today.verified >= 2);
  const totals = home.hub.totals;
  assert.ok(totals.contacts >= 40 && totals.members_active >= 10 && totals.members_expired >= 2 && totals.pending_email >= 3 && totals.leads >= 3);
  assert.equal(totals.members_no_expiry, 1);
  assert.equal(totals.publishers, 1);
  assert.ok(home.hub.expiring.d7 >= 1 && home.hub.expiring.d30 >= home.hub.expiring.d7);
  assert.ok(home.hub.expiring.items.every((item: { days_left: number }) => item.days_left <= 30));
  assert.ok(home.hub.per_site.length >= 2 && home.hub.mail.sent > 0);

  assert.equal(home.app.payments.series.length, 14);
  assert.deepEqual(home.app.payments.today, { count: 0, cents: 0, paid: 0 });
  assert.deepEqual(Object.keys(home.app.store.series[0]), ['day', 'purchases', 'renewals']);
  assert.equal(home.app.push.devices, 0);
  assert.equal(typeof home.pb.unlocksToday, 'number');
  assert.deepEqual(home.bridge, { hub: { version: '2.7.0-mock', ok: true }, pb: { version: MOCK_PB_VERSION, ok: true } });
  assert.deepEqual(home.errors, {});
  assert.equal((await get('/api/admin/home?days=3', adminToken)).statusCode, 400);

  // The same answer serves the next admin for a short while: one hub call.
  const before = hub.count('admin_stats');
  await get('/api/admin/home?days=14', adminToken);
  assert.equal(hub.count('admin_stats'), before);
  const health = (await app.inject({ method: 'GET', url: '/health' })).json();
  assert.equal(health.bridge.hub.version, '2.7.0-mock');
  assert.equal(health.bridge.pbMode, 'mock');
});

test('accounts: states, search, counts, and the Projects Bank balance beside every active member through one call', async () => {
  const all = await get('/api/admin/accounts?per_page=100', adminToken);
  const body = all.json();
  assert.ok(body.total >= 36 && body.items.every((item: { state: string }) => item.state !== 'lead'));
  assert.deepEqual(Object.keys(body.counts).sort(), ['admin', 'all', 'expired', 'lead', 'member', 'pending', 'publisher', 'unpaid']);
  assert.equal(body.pbError, null);
  for (const item of body.items as { state: string; pb: { left: number; used: number; granted: number } | null }[]) {
    if (item.state === 'member') assert.deepEqual(Object.keys(item.pb ?? {}), ['left', 'used', 'granted']);
    else assert.equal(item.pb, null);
  }

  const leads = (await get('/api/admin/accounts?state=lead', adminToken)).json();
  assert.ok(leads.total >= 3 && leads.items.every((item: { state: string; has_password: number }) => item.state === 'lead' && item.has_password === 0));
  const found = (await get(`/api/admin/accounts?q=${encodeURIComponent('m20.admin@gmail.com')}`, adminToken)).json();
  assert.deepEqual(found.items.map((item: { id: number }) => item.id), [adminId]);
  assert.equal((await get('/api/admin/accounts?state=nope', adminToken)).statusCode, 400);

  const member = await someMember();
  const detail = (await get(`/api/admin/accounts/${member.id}`, adminToken)).json();
  assert.equal(detail.account.id, member.id);
  assert.ok(detail.events.some((event: { kind: string }) => event.kind === 'activated'));
  assert.deepEqual(Object.keys(detail.pb), ['credits', 'granted', 'used', 'left', 'period_start', 'unlocked']);
  assert.equal((await get('/api/admin/accounts/999999', adminToken)).statusCode, 404);
});

test('hub lists: payments with their sum, tickets, leads, threads, one thread and the mail queue without bodies', async () => {
  const payments = (await get('/api/admin/hub-payments?status=ok', adminToken)).json();
  assert.ok(payments.total > 0 && payments.sum_cents_ok > 0);
  assert.ok(payments.items.every((item: { success: number }) => item.success === 1));
  const failed = (await get('/api/admin/hub-payments?status=failed', adminToken)).json();
  assert.ok(failed.total > 0 && failed.sum_cents_ok === 0);
  assert.ok((await get('/api/admin/tickets', adminToken)).json().items[0].ref.startsWith('VC-'));
  const leads = (await get('/api/admin/leads?ltype=partner', adminToken)).json();
  assert.ok(leads.items.every((item: { ltype: string; intent_label: string }) => item.ltype === 'partner' && item.intent_label));

  const waiting = (await get('/api/admin/threads?filter=waiting', adminToken)).json();
  assert.ok(waiting.total >= 1 && waiting.items.every((item: { waiting: number; last_role: string }) => item.waiting === 1 && item.last_role === 'user'));
  const contactId = waiting.items[0].contact_id as number;
  const thread = (await get(`/api/admin/threads/${contactId}`, adminToken)).json();
  assert.equal(thread.account.id, contactId);
  assert.deepEqual(Object.keys(thread.messages[0]), ['id', 'role', 'content', 'by', 'page_url', 'at']);
  assert.ok(thread.messages[0].id < thread.messages.at(-1).id || thread.messages.length === 1, 'oldest first');

  const mail = (await get('/api/admin/mail', adminToken)).json();
  assert.deepEqual(Object.keys(mail.stats), ['pending', 'sent', 'failed']);
  assert.ok(mail.items.length > 0 && mail.items.every((item: Record<string, unknown>) => !('body' in item)));
});

test('a staff reply lands in the conversation, signed with the admin name, and in the audit log', async () => {
  const waiting = (await get('/api/admin/threads?filter=waiting', adminToken)).json();
  const contactId = waiting.items[0].contact_id as number;
  assert.equal((await post(`/api/admin/threads/${contactId}/reply`, { text: '  ', confirm: true }, adminToken)).statusCode, 400);
  // Like every dashboard write, a reply needs `confirm: true`.
  assert.equal((await post(`/api/admin/threads/${contactId}/reply`, { text: 'رد بلا تأكيد' }, adminToken)).statusCode, 400);
  assert.equal(hub.count('admin_reply'), 0, 'nothing reached the hub');
  const sent = await post(`/api/admin/threads/${contactId}/reply`, { text: 'أهلًا بك، معك إدارة النادي. نراجع طلبك الآن.', confirm: true }, adminToken);
  assert.equal(sent.statusCode, 200, sent.body);
  assert.ok(sent.json().message_id > 0);
  const thread = (await get(`/api/admin/threads/${contactId}`, adminToken)).json();
  assert.deepEqual([thread.messages.at(-1).role, thread.messages.at(-1).by], ['human', 'مدير اللوحة']);
  const still = (await get('/api/admin/threads?filter=waiting', adminToken)).json();
  assert.ok(!still.items.some((item: { contact_id: number }) => item.contact_id === contactId), 'the list was dropped from the cache and no longer waits');
  const entry = (await get('/api/admin/audit', adminToken)).json().entries[0] as AuditEntry;
  assert.deepEqual([entry.action, entry.contactId, entry.result, entry.actor.id], ['reply', contactId, 'ok', adminId]);
});

test('grant: confirm is required, remaining days are never lost, the write is audited and a repeated requestId changes nothing', async () => {
  const member = await someMember();
  const url = `/api/admin/accounts/${member.id}/grant`;
  const refused = await post(url, { action: 'extend', days: 30, note: 'هدية' }, adminToken);
  assert.equal(refused.statusCode, 400);
  assert.equal((await post(url, { action: 'extend', confirm: true }, adminToken)).statusCode, 400, 'days are required');
  assert.equal(hub.count('admin_grant'), 0, 'nothing reached the hub');

  const first = await post(url, { action: 'extend', days: 30, note: 'تعويض عن ملتقى ملغى', confirm: true, requestId: 'req-grant-0001' }, adminToken);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().already, false);
  assert.equal(first.json().contact.member_left, member.member_left + 30);
  assert.deepEqual([first.json().event.kind, first.json().event.source, first.json().event.actor_id, first.json().event.days], ['renewed', 'admin', adminId, 30]);

  // A double tap on a phone: the same requestId replays the first answer, the hub is not called again.
  const again = await post(url, { action: 'extend', days: 30, note: 'تعويض عن ملتقى ملغى', confirm: true, requestId: 'req-grant-0001' }, adminToken);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().already, true);
  assert.equal(again.json().contact.member_left, member.member_left + 30);
  assert.equal(hub.count('admin_grant'), 1);
  const detail = (await get(`/api/admin/accounts/${member.id}`, adminToken)).json();
  assert.equal(detail.account.member_left, member.member_left + 30, 'the list cache was dropped and the days were added once');
  assert.equal(detail.events.filter((event: { source: string }) => event.source === 'admin').length, 1);

  const entries = ((await kv.get<{ entries: AuditEntry[] }>(AUDIT_KEY))?.entries ?? []).filter((entry) => entry.action === 'grant');
  assert.equal(entries.length, 1);
  assert.deepEqual([entries[0]?.actor.email, entries[0]?.contactId, entries[0]?.note, entries[0]?.result, entries[0]?.params.days], ['m20.admin@gmail.com', member.id, 'تعويض عن ملتقى ملغى', 'ok', 30]);

  const revoked = await post(url, { action: 'revoke', note: 'طلب العضو', confirm: true }, adminToken);
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal(revoked.json().contact.is_member, 0);
  assert.equal(revoked.json().event.kind, 'revoked');
});

test('a real double tap: two requests with one requestId at the same moment write once', async () => {
  const member = await someMember();
  const url = `/api/admin/accounts/${member.id}/grant`;
  const grants = hub.count('admin_grant');
  const payload = { action: 'extend', days: 30, note: 'نقرتان', confirm: true, requestId: 'req-race-0001' };
  hub.grantDelayMs = 50;
  try {
    const both = await Promise.all([post(url, payload, adminToken), post(url, payload, adminToken)]);
    assert.deepEqual(both.map((res) => res.statusCode), [200, 200]);
    assert.deepEqual(both.map((res) => res.json().already as boolean).sort(), [false, true]);
    assert.deepEqual(both.map((res) => res.json().contact.member_left), [member.member_left + 30, member.member_left + 30]);
    assert.equal(hub.count('admin_grant'), grants + 1, 'the hub was asked once');

    // Two taps on a write that fails: both hear the same error, and the hub was asked once.
    const failed = await Promise.all([1, 2].map(() => post('/api/admin/accounts/999998/grant', { action: 'activate', days: 30, confirm: true, requestId: 'req-race-0002' }, adminToken)));
    assert.deepEqual(failed.map((res) => res.statusCode), [404, 404]);
    assert.equal(hub.count('admin_grant'), grants + 2);
  } finally {
    hub.grantDelayMs = 0;
  }
  assert.equal((await get(`/api/admin/accounts/${member.id}`, adminToken)).json().account.member_left, member.member_left + 30);
  const entries = ((await kv.get<{ entries: AuditEntry[] }>(AUDIT_KEY))?.entries ?? []).filter((entry) => entry.requestId?.startsWith('req-race-'));
  assert.deepEqual(entries.map((entry) => [entry.requestId, entry.result]), [['req-race-0002', 'error'], ['req-race-0001', 'ok']]);
});

test('a write the hub applied stays a success when its audit entry cannot be saved, and a retry replays it', async () => {
  const member = await someMember();
  const url = `/api/admin/accounts/${member.id}/grant`;
  const grants = hub.count('admin_grant');
  const stored = async () => ((await kv.get<{ entries: AuditEntry[] }>(AUDIT_KEY))?.entries ?? []).filter((entry) => entry.requestId?.startsWith('req-nolog-'));

  // kv fails once: the entry is saved at the second attempt.
  kv.failAudit = 1;
  const first = await post(url, { action: 'extend', days: 10, confirm: true, requestId: 'req-nolog-0001' }, adminToken);
  assert.deepEqual([first.statusCode, first.json().already, first.json().contact.member_left], [200, false, member.member_left + 10]);
  assert.deepEqual((await stored()).map((entry) => [entry.requestId, entry.result]), [['req-nolog-0001', 'ok']]);

  // kv stays down: the answer is still 200, nothing says "error" about a change that happened, and the retry writes nothing.
  kv.failAudit = 2;
  const second = await post(url, { action: 'extend', days: 10, confirm: true, requestId: 'req-nolog-0002' }, adminToken);
  assert.deepEqual([second.statusCode, second.json().already, second.json().contact.member_left], [200, false, member.member_left + 20]);
  assert.equal(kv.failAudit, 0);
  assert.equal((await stored()).length, 1);
  const retry = await post(url, { action: 'extend', days: 10, confirm: true, requestId: 'req-nolog-0002' }, adminToken);
  assert.deepEqual([retry.statusCode, retry.json().already, retry.json().contact.member_left], [200, true, member.member_left + 20]);
  assert.equal(hub.count('admin_grant'), grants + 2);

  // A failed write whose entry cannot be saved still answers with the hub's own error.
  kv.failAudit = 1;
  assert.equal((await post('/api/admin/accounts/999997/grant', { action: 'activate', days: 30, confirm: true }, adminToken)).statusCode, 404);
  kv.failAudit = 0;
});

test('a failed write is audited too', async () => {
  const res = await post('/api/admin/accounts/999999/grant', { action: 'activate', days: 365, confirm: true }, adminToken);
  assert.equal(res.statusCode, 404);
  const entry = (await get('/api/admin/audit?limit=1', adminToken)).json().entries[0] as AuditEntry;
  assert.deepEqual([entry.action, entry.contactId, entry.result, entry.error], ['grant', 999999, 'error', 'no_contact']);
});

test('role: member and publisher only, the admin role stays on the hub page', async () => {
  const unpaid = (await get('/api/admin/accounts?state=unpaid&per_page=100', adminToken)).json().items.find((item: { role: string }) => item.role === 'member') as { id: number };
  assert.equal((await post(`/api/admin/accounts/${unpaid.id}/role`, { role: 'admin', confirm: true }, adminToken)).statusCode, 400);
  const res = await post(`/api/admin/accounts/${unpaid.id}/role`, { role: 'publisher', confirm: true }, adminToken);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual([res.json().contact.role, res.json().contact.is_admin], ['publisher', 0]);
  assert.ok((await get('/api/admin/accounts?state=publisher', adminToken)).json().items.some((item: { id: number }) => item.id === unpaid.id));
  // The signed-in admin cannot be demoted from here.
  assert.equal((await post(`/api/admin/accounts/${adminId}/role`, { role: 'member', confirm: true }, adminToken)).statusCode, 400);
});

test('pb-grant adds Projects Bank balance to a member, never below what he used, and only to members', async () => {
  const member = await someMember();
  const url = `/api/admin/accounts/${member.id}/pb-grant`;
  assert.equal((await post(url, { amount: 0, confirm: true }, adminToken)).statusCode, 400);
  assert.equal((await post(url, { amount: 2 }, adminToken)).statusCode, 400);
  const res = await post(url, { amount: 2, note: 'هدية ملتقى الشراكات', confirm: true }, adminToken);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual([res.json().granted, res.json().left], [2, member.pb.left + 2]);
  const listed = (await get('/api/admin/accounts?state=member&per_page=100', adminToken)).json().items.find((item: { id: number }) => item.id === member.id);
  assert.deepEqual(listed.pb, { left: member.pb.left + 2, used: member.pb.used, granted: 2 });
  const below = await post(url, { amount: -50, confirm: true }, adminToken);
  assert.deepEqual([below.statusCode, below.json().error.code], [400, 'below_used']);

  const unpaid = (await get('/api/admin/accounts?state=unpaid', adminToken)).json().items[0] as { id: number };
  const refused = await post(`/api/admin/accounts/${unpaid.id}/pb-grant`, { amount: 1, confirm: true }, adminToken);
  assert.deepEqual([refused.statusCode, refused.json().error.code], [409, 'not_member']);
});

test('a hub older than 2.7.0 degrades per section instead of failing the dashboard', async () => {
  const oldKv = new MemoryKV();
  const oldHub = new StagedHub();
  const built = await buildApp({ config, kv: oldKv, hub: oldHub, pb: new OffPbBridge() });
  const registered = await built.app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'مدير قديم', country: 'sa', phone: '0558318703', email: 'm20.old@gmail.com', password: 'secret123', persona: 'neutral', bio: 'حساب لاختبار الهب القديم.' } });
  const verified = await built.app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  const headers = { authorization: `Bearer ${verified.json().token as string}` };
  oldHub.old = true;

  const home = await built.app.inject({ method: 'GET', url: '/api/admin/home', headers });
  assert.equal(home.statusCode, 200, home.body);
  assert.equal(home.json().hub, null);
  assert.deepEqual(home.json().errors.hub, { code: 'hub_not_supported', message: 'حدّث إضافة الهب إلى 2.7.0' });
  assert.equal(home.json().errors.pb.code, 'pb_not_configured');
  assert.equal(home.json().pb.unlocksToday, null);
  assert.equal(home.json().app.payments.series.length, 30);

  const accounts = await built.app.inject({ method: 'GET', url: '/api/admin/accounts', headers });
  assert.deepEqual([accounts.statusCode, accounts.json().error.code, accounts.json().error.message], [501, 'hub_not_supported', 'حدّث إضافة الهب إلى 2.7.0']);
  // The posts section of the same dashboard keeps working.
  assert.equal((await built.app.inject({ method: 'GET', url: '/api/admin/posts', headers })).statusCode, 200);
  await built.app.close();
});
