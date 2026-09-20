import assert from 'node:assert/strict';
import { test } from 'node:test';

import Fastify from 'fastify';

import { RequestError } from '../auth/guard.js';
import { DAY_MS, hubTime } from '../riyadh.js';
import { LivePbBridge, MockPbBridge, OffPbBridge, type PbMember } from './bridge.js';
import type { PublicProject } from './types.js';

const log = Fastify({ logger: false }).log;
// Test-only value (rule 1: real keys live in the environment).
const KEY = 'test-pb-bridge-key-0000000000001';
// A membership year that started 65 days ago.
const memberEnd = new Date(Date.now() + 300 * DAY_MS).toISOString().slice(0, 10);
const periodStart = hubTime(Date.parse(`${memberEnd}T00:00:00+03:00`) - 365 * DAY_MS);
const member: PbMember = { contact_id: 7, member_end: memberEnd, member_days: 365, name: 'عضو', email: 'member@example.com', phone: '0550000007' };

function fakePb(answers: Record<string, { status: number; body: unknown }>) {
  const requests: { url: string; key: string | null; body: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, key: new Headers(init?.headers).get('x-pb-bridge-key'), body: JSON.parse(String(init?.body)) });
    const answer = answers[url.slice(url.lastIndexOf('/') + 1)] ?? { status: 404, body: { code: 'rest_no_route', message: 'No route was found', data: { status: 404 } } };
    return new Response(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body), { status: answer.status });
  };
  return { requests, bridge: new LivePbBridge({ url: 'https://pb.example.com/wp-json/pb/v1/bridge/', key: KEY, log, fetchImpl }) };
}

const rejects = async (run: Promise<unknown>, code: string, status: number): Promise<void> => {
  await assert.rejects(run, (error: unknown) => error instanceof RequestError && error.code === code && error.status === status);
};

test('the live bridge posts to {url}/{op} with the header-only key and the member period, and validates the answers', async () => {
  const { bridge, requests } = fakePb({
    ping: { status: 200, body: { ok: true, version: 39 } },
    balance: { status: 200, body: { ok: true, credits: '5', granted: 1, used: 2, left: 4, period_start: periodStart, unlocked: [11, '12'] } },
    balances: { status: 200, body: { ok: true, items: { 7: { credits: 5, granted: 0, used: 1, left: 4 } } } },
    unlock: { status: 200, body: { ok: true, already: false, left: 3, contact: { whatsapp: '+966500000000', email: 'f@example.com', website: 'https://example.com', pitch_url: '' } } },
    grant: { status: 200, body: { ok: true, granted: 3, left: 6 } },
    unlocks: { status: 200, body: { ok: true, total: 1, items: [{ contact_id: 7, pid: 11, title: 'مشروع', name: 'عضو', unlocked_at: '2026-09-19 10:00:00' }] } },
  });
  assert.deepEqual(await bridge.ping(), { version: '39' });
  assert.deepEqual(await bridge.balance(member), { credits: 5, granted: 1, used: 2, left: 4, period_start: periodStart, unlocked: [11, 12] });
  assert.deepEqual(await bridge.balances([member]), { 7: { credits: 5, granted: 0, used: 1, left: 4 } });
  assert.deepEqual(await bridge.balances([]), {}, 'no call for an empty page');
  assert.equal((await bridge.unlock(member, 11)).left, 3);
  assert.deepEqual(await bridge.grant({ contactId: 7, amount: 3, note: 'هدية', actor: 'المدير', member }), { granted: 3, left: 6 });
  assert.equal((await bridge.unlocks({ page: 1, perPage: 20, contactId: 7 })).total, 1);

  assert.deepEqual(requests.map((request) => request.url), ['ping', 'balance', 'balances', 'unlock', 'grant', 'unlocks'].map((op) => `https://pb.example.com/wp-json/pb/v1/bridge/${op}`));
  assert.ok(requests.every((request) => request.key === KEY && !request.url.includes(KEY)), 'the key travels in the header only');
  assert.deepEqual(requests[1]?.body, { member });
  assert.deepEqual(requests[3]?.body, { member, pid: 11 });
  assert.deepEqual(requests[4]?.body, { contact_id: 7, amount: 3, note: 'هدية', actor: 'المدير', member });
  assert.deepEqual(requests[5]?.body, { page: 1, per_page: 20, contact_id: 7 });
});

test('plugin errors keep their code and status; an older plugin, a bad key and a strange answer are told apart', async () => {
  const { bridge } = fakePb({
    unlock: { status: 402, body: { code: 'no_credit', message: 'انتهى رصيدك', data: { status: 402 } } },
    balance: { status: 403, body: { code: 'forbidden', message: 'bad key', data: { status: 403 } } },
    grant: { status: 200, body: { ok: true, granted: 'كثير' } },
    unlocks: { status: 200, body: '<html>cache page</html>' },
  });
  await rejects(bridge.unlock(member, 11), 'no_credit', 402);
  await rejects(bridge.balance(member), 'pb_config', 502);
  await rejects(bridge.grant({ contactId: 7, amount: 1, note: '', actor: '' }), 'pb_error', 502);
  await rejects(bridge.unlocks({ page: 1, perPage: 10 }), 'pb_error', 502);
  await rejects(bridge.ping(), 'pb_not_supported', 501);
  const offline = new LivePbBridge({ url: 'https://pb.example.com/bridge', key: KEY, log, fetchImpl: async () => Promise.reject(new Error('offline')) });
  await rejects(offline.ping(), 'pb_unreachable', 502);
  await rejects(new OffPbBridge().balance(), 'pb_not_configured', 501);
});

test('rule 4: whatever Projects Bank answers to `unlock`, the founder’s contact data never reaches the logs', async () => {
  const lines: string[] = [];
  const spy = Fastify({ logger: { level: 'trace', stream: { write: (line: string) => void lines.push(line) } } }).log;
  const contact = { whatsapp: '+966555123456', email: 'founder@delivery.example.com', website: 'https://delivery.example.com', pitch_url: 'https://delivery.example.com/deck.pdf' };
  const answer = JSON.stringify({ ok: true, already: false, left: 4, contact });
  const bridgeWith = (body: string) => new LivePbBridge({ url: 'https://pb.example.com/bridge', key: KEY, log: spy, fetchImpl: async () => new Response(body, { status: 200 }) });

  // A PHP notice printed before the JSON (WordPress with display_errors): the answer is still read.
  assert.deepEqual((await bridgeWith(`<br />\n<b>Notice</b>: Undefined index in /wp-content/plugins/pb/bridge.php on line 12<br />\n${answer}`).unlock(member, 11)).contact, contact);
  // Cut short, without `ok`, or with a field of the wrong type: refused, and only the shape is logged.
  await rejects(bridgeWith(answer.slice(0, -9)).unlock(member, 11), 'pb_error', 502);
  await rejects(bridgeWith(JSON.stringify({ contact })).unlock(member, 11), 'pb_error', 502);
  await rejects(bridgeWith(JSON.stringify({ ok: true, left: 'كثير', contact })).unlock(member, 11), 'pb_error', 502);
  assert.equal(lines.length, 3);
  for (const leak of ['966555123456', 'founder@', 'delivery.example.com', 'deck.pdf']) assert.ok(!lines.join('\n').includes(leak), leak);
  assert.ok(lines.every((line) => line.includes('"op":"unlock"')));
});

test('the mock keeps the plugin’s rules: membership year, one row per project, golden costs nothing, grants never below used', async () => {
  const projects = new Map<number, Partial<PublicProject>>([
    [1, { title: 'أول', hasPitchDeck: true }],
    [2, { title: 'ثاني' }],
    [3, { title: 'ذهبي', isGolden: true, hasPitchDeck: true }],
  ]);
  const pb = new MockPbBridge({ projects: { get: (id) => (projects.get(id) as PublicProject | undefined) ?? null } });
  assert.deepEqual(await pb.balance(member), { credits: 5, granted: 0, used: 0, left: 5, period_start: periodStart, unlocked: [] });
  const first = await pb.unlock(member, 1);
  assert.deepEqual([first.already, first.left, first.contact.pitch_url.endsWith('.pdf')], [false, 4, true]);
  assert.deepEqual([(await pb.unlock(member, 1)).already, (await pb.unlock(member, 1)).left], [true, 4]);
  const golden = await pb.unlock(member, 3);
  assert.deepEqual([golden.left, golden.contact.pitch_url], [4, '']);
  await rejects(pb.unlock(member, 99), 'not_found', 404);
  await rejects(pb.unlock({ ...member, member_end: '2020-01-01' }, 2), 'not_member', 403);

  assert.deepEqual(await pb.grant({ contactId: 7, amount: -4, note: '', actor: 'المدير', member }), { granted: -4, left: 0 });
  await rejects(pb.unlock(member, 2), 'no_credit', 402);
  await rejects(pb.grant({ contactId: 7, amount: -1, note: '', actor: 'المدير', member }), 'below_used', 400);
  assert.deepEqual(await pb.grant({ contactId: 7, amount: 6, note: '', actor: 'المدير', member }), { granted: 2, left: 6 });
  assert.deepEqual((await pb.balances([member, { ...member, contact_id: 8 }]))['8'], { credits: 5, granted: 0, used: 0, left: 5 });
  assert.deepEqual((await pb.unlocks({ page: 1, perPage: 10 })).items.map((row) => [row.contact_id, row.pid]), [[7, 1]]);

  // `demo` gives the seeded hub members a usage to show in the dashboard.
  const demo = new MockPbBridge({ projects: { get: () => null }, demo: true });
  assert.equal((await demo.balance({ ...member, contact_id: 3 })).used, 3);
});
