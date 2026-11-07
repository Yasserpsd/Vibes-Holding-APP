import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { AUDIT_KEY, type AuditEntry } from './dashboard/service.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { HubError, type HubBody, type HubClient, type HubOp, type HubResponse } from './hub/types.js';
import type { Mail, Mailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

/** The mock hub; `oldVersion` makes it answer the way a hub before 2.30.0 answers an unknown op. */
class StagedHub implements HubClient {
  readonly mode = 'mock' as const;
  oldVersion: string | null = null;
  constructor(readonly inner = new MockHubClient({ seed: true })) {}

  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    if (this.oldVersion && op === 'ping') return { ok: true, version: this.oldVersion } as unknown as HubResponse;
    if (this.oldVersion && op === 'admin_delete') throw new HubError('not_found', 'عملية غير معروفة', 404);
    return this.inner.call(op, body);
  }
}

const sent: Mail[] = [];
const mailer = {
  configured: true,
  send: async (mail: Mail) => {
    sent.push(mail);
    return true;
  },
} as unknown as Mailer;
const kv = new MemoryKV();
const hub = new StagedHub();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admins@example.com' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let adminToken = '';
let adminId = 0;
let caller = 0;

const call = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>, token?: string) => {
  caller += 1;
  return app.inject({ method, url, ...(payload ? { payload } : {}), remoteAddress: `10.6.0.${(caller % 250) + 1}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
};
const remove = (id: number, extra: Record<string, unknown> = {}, token = adminToken) => call('POST', `/api/admin/accounts/${id}/delete`, { note: 'مخالفة شروط الاستخدام', confirm: true, ...extra }, token);

let phone = 8316100;
async function signUp(email: string): Promise<{ token: string; id: number }> {
  phone += 1;
  const registered = await call('POST', '/api/auth/register', { name: 'سلطان العتيبي', country: 'sa', phone: `055${phone}`, email, password: 'secret123', persona: 'investor', job: 'مدير استثمار' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await call('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  const id = verified.json().me.id as number;
  const token = verified.json().token as string;
  // The mock makes every verified account an admin: a plain member is set back by hand.
  if (!email.includes('admin')) {
    const contacts = (hub.inner as unknown as { state: { contacts: Map<number, { role: string }> } }).state.contacts;
    const contact = contacts.get(id);
    if (contact) contact.role = 'member';
    await call('GET', '/api/me?fresh=1', undefined, token);
  }
  return { token, id };
}

before(async () => {
  ({ app } = await buildApp({ config, hub, kv, mailer }));
  const admin = await signUp('m216.admin@gmail.com');
  adminToken = admin.token;
  adminId = admin.id;
});

after(async () => {
  await app.close();
});

test('a deleted member is signed out at once, every session of theirs, and the audit keeps one entry', async () => {
  const member = await signUp('m216a+member@example.com');
  assert.equal((await call('GET', '/api/me', undefined, member.token)).statusCode, 200);
  const answer = await remove(member.id, { requestId: 'm216-request-1' });
  assert.equal(answer.statusCode, 200, answer.body);
  assert.equal((await call('GET', '/api/me', undefined, member.token)).statusCode, 401);
  const again = await remove(member.id, { requestId: 'm216-request-1' });
  assert.equal(again.json().already, true);
  const audit = ((await kv.get<{ entries: AuditEntry[] }>(AUDIT_KEY))?.entries ?? []).filter((entry) => entry.action === 'delete' && entry.contactId === member.id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.result, 'ok');
  assert.equal(audit[0]?.note, 'مخالفة شروط الاستخدام');
});

test('non-admins, a missing reason and a missing confirm are refused', async () => {
  const member = await signUp('m216b+member@example.com');
  const other = await signUp('m216c+member@example.com');
  assert.equal((await remove(other.id, {}, member.token)).statusCode, 403);
  assert.equal((await call('POST', `/api/admin/accounts/${other.id}/delete`, { note: 'x', confirm: true })).statusCode, 401);
  assert.equal((await remove(other.id, { note: '' })).statusCode, 400);
  assert.equal((await call('POST', `/api/admin/accounts/${other.id}/delete`, { note: 'مخالفة' }, adminToken)).statusCode, 400);
  assert.equal((await call('GET', '/api/me', undefined, other.token)).statusCode, 200);
});

test('an admin account and the actor\'s own are refused', async () => {
  const self = await remove(adminId);
  assert.equal(self.statusCode, 403);
  assert.equal(self.json().error.code, 'self_delete');
  assert.equal((await call('GET', '/api/me', undefined, adminToken)).statusCode, 200);
});

test('the member is told only when the admin asks; the management always is', async () => {
  const quiet = await signUp('m216d+member@example.com');
  const told = await signUp('m216e+member@example.com');
  sent.length = 0;
  await remove(quiet.id);
  await remove(told.id, { tellMember: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.filter((mail) => mail.to.includes('m216d+member@example.com')).length, 0);
  assert.equal(sent.filter((mail) => mail.to.includes('m216e+member@example.com')).length, 1);
  assert.equal(sent.filter((mail) => mail.subject.includes('حذف حساب من لوحة التحكم')).length, 2);
});

test('the member\'s own 30-day request shows on the sheet and ends with the deletion', async () => {
  const member = await signUp('m216f+member@example.com');
  await kv.set('deletion:scheduled', { byContact: { [member.id]: { contactId: member.id, uuid: 'u', email: 'm216f+member@example.com', name: 'سلطان', phone: '', reason: 'لا أستخدمه', requestedAt: '2026-10-01T00:00:00.000Z', dueAt: '2026-10-31T00:00:00.000Z' } } });
  const sheet = await call('GET', `/api/admin/accounts/${member.id}`, undefined, adminToken);
  assert.equal(sheet.json().deletionRequest.reason, 'لا أستخدمه');
  await remove(member.id);
  assert.equal((await call('GET', `/api/admin/accounts/${member.id}`, undefined, adminToken)).json().deletionRequest, null);
});

test('a hub before 2.30.0 gets a clear message and nothing changes', async () => {
  const member = await signUp('m216g+member@example.com');
  hub.oldVersion = '2.29.0';
  const answer = await remove(member.id);
  hub.oldVersion = null;
  assert.equal(answer.statusCode, 501);
  assert.equal(answer.json().error.code, 'hub_not_supported');
  assert.equal((await call('GET', '/api/me', undefined, member.token)).statusCode, 200);
});
