import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import Fastify from 'fastify';

import { LiveHubClient } from './client.js';
import { MockHubClient } from './mock.js';
import { HubError, hubCall } from './types.js';

const log = Fastify({ logger: false }).log;
// Test-only value (rule 1: the real site key lives in the environment).
const SITE_KEY = 'test-site-key-0000000000000000';

function answerWith(status: number, body: unknown) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status });
  });
  return requests;
}

const rejects = async (run: Promise<unknown>, code: string, status: number): Promise<void> => {
  await assert.rejects(run, (error: unknown) => error instanceof HubError && error.code === code && error.status === status);
};

afterEach(() => mock.restoreAll());

test('bridge v2 ops go to /hub/{op} with the site key in the header, typed by op', async () => {
  const requests = answerWith(200, { ok: true, total: 1, page: 1, per_page: 25, counts: { all: 1 }, items: [{ id: 5, name: 'عضو', state: 'member' }] });
  const hub = new LiveHubClient({ url: 'https://hub.example.com/', siteKey: SITE_KEY, log });
  const result = await hubCall(hub, 'admin_accounts', { uuid: 'app-12345678', state: 'member' });
  assert.deepEqual([result.total, result.items[0]?.state], [1, 'member']);
  assert.equal(requests[0]?.url, 'https://hub.example.com/wp-json/vibes-ai/v1/hub/admin_accounts');
  assert.equal(requests[0]?.headers.get('x-vai-site-key'), SITE_KEY);
  assert.ok(!requests[0]?.url.includes(SITE_KEY));
  assert.deepEqual(requests[0]?.body, { uuid: 'app-12345678', state: 'member' });
});

test('a hub older than 2.7.0 answers hub_not_supported; a missing record inside a v2 op keeps its own 404', async () => {
  const hub = new LiveHubClient({ url: 'https://hub.example.com', siteKey: SITE_KEY, log });
  answerWith(404, { code: 'not_found', message: 'عملية غير معروفة', data: { status: 404 } });
  await rejects(hub.call('admin_stats', { uuid: 'app-12345678' }), 'hub_not_supported', 501);
  await rejects(hub.call('delete_account', { uuid: 'app-12345678' }), 'hub_not_supported', 501);
  mock.restoreAll();
  answerWith(404, { code: 'not_found', message: 'الحساب غير موجود', data: { status: 404 } });
  await rejects(hub.call('admin_member', { uuid: 'app-12345678', contact_id: 9 }), 'not_found', 404);
});

test('an untrusted site is a setup problem (502), never a 403 that would sign the admin out; not_admin stays a 403', async () => {
  const hub = new LiveHubClient({ url: 'https://hub.example.com', siteKey: SITE_KEY, log });
  answerWith(403, { code: 'forbidden', message: 'غير مصرح', data: { status: 403 } });
  await rejects(hub.call('admin_grant', { uuid: 'app-12345678' }), 'hub_not_trusted', 502);
  await rejects(hub.call('publish', { uuid: 'app-12345678' }), 'hub_not_trusted', 502);
  mock.restoreAll();
  answerWith(403, { code: 'not_admin', message: 'هذا الحساب ليس من إدارة النادي', data: { status: 403 } });
  await rejects(hub.call('admin_stats', { uuid: 'app-12345678' }), 'not_admin', 403);
});

test('the mock hub: store activations are idempotent on the reference and never lose remaining days', async () => {
  const hub = new MockHubClient({ seed: true });
  const registered = await hub.call('register', { uuid: 'app-owner-0001', name: 'مالك', country: 'sa', phone: '0558318731', email: 'mock.owner@gmail.com', password: 'secret123', persona: 'neutral', bio: 'حساب إدارة لاختبار الهب الوهمي.' });
  await hub.call('verify', { uuid: 'app-owner-0001', code: '123456' });
  const id = registered.contact?.id ?? 0;
  const first = await hubCall(hub, 'activate_member', { contact_id: id, days: 365, reference: 'GPA.1111', product: 'club_membership_annual', store: 'PLAY_STORE' });
  assert.deepEqual([first.already, first.contact.member_left], [false, 365]);
  const repeated = await hubCall(hub, 'activate_member', { contact_id: id, days: 365, reference: 'GPA.1111', product: 'club_membership_annual', store: 'PLAY_STORE' });
  assert.deepEqual([repeated.already, repeated.contact.member_left], [true, 365]);
  const renewed = await hubCall(hub, 'activate_member', { contact_id: id, days: 365, reference: 'GPA.2222', product: 'club_membership_annual', store: 'PLAY_STORE' });
  assert.deepEqual([renewed.already, renewed.contact.member_left], [false, 730]);
  const member = await hubCall(hub, 'admin_member', { uuid: 'app-owner-0001', contact_id: id });
  assert.deepEqual(member.events.map((event) => [event.kind, event.source, event.ref]).reverse(), [['registered', 'app', ''], ['verified', 'app', ''], ['activated', 'store', 'GPA.1111'], ['renewed', 'store', 'GPA.2222']]);

  // The dashboard ops need an admin's uuid; `publish` also takes a publisher.
  await rejects(hub.call('admin_stats', { uuid: 'app-stranger-01' }), 'not_admin', 403);
  const stats = await hubCall(hub, 'admin_stats', { uuid: 'app-owner-0001', days: 60 });
  assert.equal(stats.series.length, 60);
  assert.equal(stats.series.reduce((sum, day) => sum + day.signups, 0) >= 25, true, 'the demo club signed up over the last 60 days');
  assert.ok(stats.series.reduce((sum, day) => sum + day.payments_cents, 0) > 0);
  assert.equal(stats.totals.contacts, 41);
});
