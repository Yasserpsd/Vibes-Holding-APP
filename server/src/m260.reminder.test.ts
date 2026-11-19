import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FastifyBaseLogger } from 'fastify';

import type { HubClient, HubResponse } from './hub/types.js';
import { MemoryKV } from './store.js';
import { MembershipReminder, quietHour } from './whatsapp/reminder.js';

// M260 (owner, 2026-11-19): one WhatsApp reminder to a new account without a membership, a day later. The M252
// incident is the reason for every rule here: once per number, never at night, never late, never on a backlog.
const HOUR = 3_600_000;
const log = { info: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;
/** 12:00 in Riyadh. */
const NOON = Date.parse('2026-11-20T09:00:00.000Z');

function rig(members: Record<string, Partial<{ found: boolean; member: boolean; proven: boolean; account: boolean }>> = {}) {
  const state = { now: NOON, sent: [] as { phone: string; name: string; lang: string }[], asked: [] as string[], enabled: true, hubDown: false };
  const hub = {
    mode: 'mock',
    call: async (op: string, body: Record<string, unknown>): Promise<HubResponse> => {
      assert.equal(op, 'member_status');
      if (state.hubDown) throw new Error('hub down');
      const phone = String(body.phone);
      state.asked.push(phone);
      const known = members[phone] ?? {};
      if (known.found === false) return { ok: true, found: false } as HubResponse;
      return { ok: true, found: true, is_member: known.member ? 1 : 0, contact: { id: 1, has_account: known.account === false ? 0 : 1, phone_verified: known.proven === false ? 0 : 1, is_member: known.member ? 1 : 0 } } as unknown as HubResponse;
    },
  } as unknown as HubClient;
  const reminder = new MembershipReminder({
    kv: new MemoryKV(),
    hub,
    log,
    enabled: () => state.enabled,
    delayMs: 24 * HOUR,
    now: () => state.now,
    send: async (input) => {
      state.sent.push({ phone: input.phone, name: input.name, lang: input.lang });
      return { channel: 'whatsapp', messageId: `wamid.${state.sent.length}` };
    },
  });
  return { state, reminder };
}

test('m260: nothing leaves before a day has passed; then one message, once', async () => {
  const { state, reminder } = rig();
  await reminder.note({ phone: '+966 55 870 0001', name: 'صالح الغامدي', lang: 'ar' });
  assert.deepEqual(await reminder.run(), { sent: 0, dropped: 0, waiting: 1 });
  state.now += 23 * HOUR;
  assert.equal((await reminder.run()).sent, 0);
  state.now += 2 * HOUR;
  assert.deepEqual(await reminder.run(), { sent: 1, dropped: 0, waiting: 0 });
  assert.deepEqual(state.sent, [{ phone: '966558700001', name: 'صالح الغامدي', lang: 'ar' }]);
  // The queue is empty and the number is remembered: a second sign-up on it queues nothing.
  await reminder.note({ phone: '966558700001', name: 'صالح', lang: 'ar' });
  state.now += 30 * HOUR;
  assert.equal((await reminder.run()).sent, 0);
  assert.equal(state.sent.length, 1, 'one number hears it once in its life');
});

test('m260: a member, an unproven number, a gone account and a silent hub get nothing', async () => {
  const { state, reminder } = rig({
    '966558700002': { member: true },
    '966558700003': { proven: false },
    '966558700004': { found: false },
    '966558700005': { account: false },
  });
  for (const tail of ['2', '3', '4', '5']) await reminder.note({ phone: `96655870000${tail}`, name: 'عضو جديد', lang: 'en' });
  state.now += 25 * HOUR;
  assert.deepEqual(await reminder.run(), { sent: 0, dropped: 4, waiting: 0 });
  assert.equal(state.sent.length, 0);
  // The hub does not answer: no message on a guess, and the reminder is not kept for a later burst.
  await reminder.note({ phone: '966558700006', name: 'عضو جديد', lang: 'ar' });
  state.now += 25 * HOUR;
  state.hubDown = true;
  assert.deepEqual(await reminder.run(), { sent: 0, dropped: 1, waiting: 0 });
  state.hubDown = false;
  assert.equal((await reminder.run()).sent, 0);
});

test('m260: nothing leaves at night, and a reminder that is too late is dropped, never sent late', async () => {
  const { state, reminder } = rig();
  assert.equal(quietHour(Date.parse('2026-11-20T19:30:00.000Z')), true, '22:30 Riyadh');
  assert.equal(quietHour(Date.parse('2026-11-20T05:59:00.000Z')), true, '08:59 Riyadh');
  assert.equal(quietHour(Date.parse('2026-11-20T06:00:00.000Z')), false, '09:00 Riyadh');
  // Signed up at 23:00 Riyadh: due at 23:00 the next night, so it waits for 09:00.
  state.now = Date.parse('2026-11-20T20:00:00.000Z');
  await reminder.note({ phone: '966558700007', name: 'Omar Hassan', lang: 'en' });
  state.now += 24 * HOUR;
  assert.deepEqual(await reminder.run(), { sent: 0, dropped: 0, waiting: 1 });
  state.now = Date.parse('2026-11-22T06:10:00.000Z');
  assert.equal((await reminder.run()).sent, 1);
  assert.equal(state.sent[0]?.lang, 'en');
  // A server that was down for a day: what is overdue by more than fourteen hours is dropped.
  await reminder.note({ phone: '966558700008', name: 'عضو جديد', lang: 'ar' });
  state.now += (24 + 15) * HOUR;
  // 09:10 + 39 h = 00:10 two days later, in the quiet hours: move to the morning, still overdue.
  state.now = Date.parse('2026-11-24T07:00:00.000Z');
  assert.deepEqual(await reminder.run(), { sent: 0, dropped: 1, waiting: 0 });
  assert.equal(state.sent.length, 1);
});

test('m260: the switch off queues nothing and sends nothing', async () => {
  const { state, reminder } = rig();
  state.enabled = false;
  await reminder.note({ phone: '966558700009', name: 'عضو جديد', lang: 'ar' });
  state.enabled = true;
  state.now += 30 * HOUR;
  assert.deepEqual(await reminder.run(), { sent: 0, dropped: 0, waiting: 0 });
});
