import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryKV } from '../store.js';
import { WhatsappClient, type WaTemplate } from './client.js';
import { WhatsappService } from './service.js';
import { quietHour, remindAudience, type RemindDeps } from './tell.js';

// M269 (owner, 2026-11-23): the dashboard's «إرسال تذكير» tells WhatsApp again, only whoever did not open the message,
// at most ONE management notice a day per number, never at night; the status list knows who the notice reached.

const silentLog = { info() {}, warn() {}, error() {} };
const TEMPLATES: WaTemplate[] = [{ name: 'club_admin_message', language: 'ar', status: 'APPROVED', components: [{ type: 'BODY', text: 'مرحبًا {{1}}، وصلتك رسالة جديدة من إدارة Investors Club.' }] }];
const account = (id: number, phone: string, extra: object = {}) => ({ id, name: 'ماجد العمري', phone, state: 'member', persona: 'investor', honorary: 0, ...extra });
const ACCOUNTS = [account(1, '0500000001'), account(2, '0500000002'), account(3, '0500000003'), account(4, '0500000004', { honorary: 1 }), account(5, '0500000003'), account(6, '0500000006', { state: 'lead' })];

function build(at: string) {
  const sent: string[] = [];
  const clock = { now: Date.parse(at) };
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const address = new URL(String(url));
    if (address.pathname.endsWith('/message_templates')) return new Response(JSON.stringify({ data: TEMPLATES.filter((item) => item.name === address.searchParams.get('name')) }), { status: 200 });
    sent.push((JSON.parse(String(init?.body)) as { to: string }).to);
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 });
  }) as typeof fetch;
  const service = new WhatsappService({ kv: new MemoryKV(), log: silentLog, enabled: true, now: () => clock.now, client: new WhatsappClient({ token: 'x'.repeat(30), phoneId: '1260740487121111', wabaId: '1371070605091256', log: silentLog, fetchImpl }) });
  const deps = {
    hub: {
      mode: 'mock' as const,
      call: async (op: string, body: { contact_id?: number }) =>
        op === 'member_status' ? { ok: true as const, contact: ACCOUNTS.find((entry) => entry.id === body.contact_id) ?? null } : { ok: true as const, items: ACCOUNTS, total: ACCOUNTS.length, page: 1, per_page: 100, counts: {} },
    },
    push: { langOf: async () => null },
    whatsapp: service,
  } as unknown as RemindDeps;
  const remind = (input: { members?: number[]; done?: number[] } = {}) => remindAudience(deps, { uuid: 'admin-uuid', persona: null, members: input.members ?? [], done: new Set(input.done ?? []), ref: 'post:p1', now: clock.now });
  return { service, sent, clock, remind };
}

test('m269: quiet hours are 22:00 to 08:00 Riyadh', () => {
  assert.equal(quietHour(Date.parse('2026-11-23T04:59:00Z')), true); // 07:59
  assert.equal(quietHour(Date.parse('2026-11-23T05:00:00Z')), false); // 08:00
  assert.equal(quietHour(Date.parse('2026-11-23T18:59:00Z')), false); // 21:59
  assert.equal(quietHour(Date.parse('2026-11-23T19:00:00Z')), true); // 22:00
});

test('m269: a reminder goes only to who did not open, once a day per number, never at night', async () => {
  const { service, sent, clock, remind } = build('2026-11-23T09:00:00Z'); // 12:00 Riyadh
  // Account 2 heard today's first announcement of ANOTHER message: its one notice of the day is spent.
  await service.sendNotice('admin_message', { phone: '0500000002', lang: 'ar', name: 'ماجد', ref: 'post:other:2' });
  sent.length = 0;

  // 1 opened it, 2 was told today, 4 is honorary, 5 shares the number of 3, 6 is a lead: only 3 hears the reminder.
  assert.deepEqual(await remind({ done: [1] }), { sent: 1, skipped: 5 });
  assert.deepEqual(sent, ['966500000003']);
  // The same day, a second press (this message or any other) reaches nobody new except… nobody: 1 still opened it.
  assert.equal((await remind({ done: [1] })).sent, 0);
  assert.equal(sent.length, 1);

  // At night nothing leaves, even on a new day.
  clock.now = Date.parse('2026-11-23T21:30:00Z'); // 00:30 Riyadh, the 24th
  assert.equal((await remind({ done: [1] })).sent, 0);
  // The next morning the day's notice is free again: 2 and 3 hear it, 1 still opened it.
  clock.now = Date.parse('2026-11-24T07:00:00Z');
  assert.deepEqual(await remind({ done: [1] }), { sent: 2, skipped: 4 });
  assert.deepEqual(sent.slice(1).sort(), ['966500000002', '966500000003']);
});

test('m269: a reminder of a message for chosen members asks the hub for each one', async () => {
  const { sent, remind } = build('2026-11-23T09:00:00Z');
  assert.deepEqual(await remind({ members: [1, 3, 99], done: [1] }), { sent: 1, skipped: 2 });
  assert.deepEqual(sent, ['966500000003']);
});

test('m269: the status keeps one row per number through a reminder and lists who the notice reached', async () => {
  const { service, clock, remind } = build('2026-11-22T09:00:00Z');
  await service.sendNotice('admin_message', { phone: '0500000003', lang: 'ar', name: 'ماجد', ref: 'post:p1:3' });
  await service.sendNotice('admin_message', { phone: '0500000001', lang: 'ar', name: 'ماجد', ref: 'post:p1:1' });
  clock.now = Date.parse('2026-11-23T09:00:00Z');
  assert.equal((await remind({ members: [3] })).sent, 1);
  await service.ingestWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.3', status: 'delivered', recipient_id: '966500000003' }] } }] }] });
  const delivery = await service.deliveryOf('admin_message', 'post:p1');
  assert.deepEqual([delivery.delivered, delivery.sent, delivery.rows.length], [1, 1, 1]);
  assert.deepEqual(delivery.reached.map((row) => [row.to, row.contactId]), [['966500000003', 3]]);
  assert.equal(delivery.rows[0]?.contactId, 1);
});
