import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NUDGE_HOURS, NUDGES_KEY, nudgeMessage, slotOf, TEMPLATES_AR, TEMPLATES_EN, WorkshopNudgeService, type NudgesState } from './agenda/nudges.js';
import type { AgendaEvent, AgendaRegistration } from './agenda/service.js';
import type { AppLang } from './lang.js';
import type { PushMessage } from './push/service.js';
import { riyadhDay, riyadhDayStart } from './riyadh.js';
import { MemoryKV } from './store.js';

// M173: twice a day (09:00 + 21:00 Riyadh) every device WITHOUT a confirmed seat hears about an upcoming open
// workshop, in a different wording every time; several workshops take turns; confirmed attendees are left alone.

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return silentLog; } } as unknown as import('fastify').FastifyBaseLogger;

const today = riyadhDay(Date.now());
const plusDays = (days: number) => riyadhDay(riyadhDayStart(today) + days * 86_400_000);
const at = (hour: number, dayOffset = 0) => riyadhDayStart(today) + dayOffset * 86_400_000 + hour * 3_600_000 + 60_000;

const event = (overrides: Partial<AgendaEvent>): AgendaEvent => ({
  id: 'ev1',
  title: 'ورشة الذكاء الاصطناعي',
  blurb: '',
  date: plusDays(5),
  time: '19:00',
  endTime: '21:00',
  place: 'مقر النادي',
  onlineUrl: '',
  mode: 'both',
  feeSar: 290,
  memberFeeSar: 0,
  open: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  en: { title: 'The AI workshop', blurb: '', place: null },
  ...overrides,
});

type Device = { contactId: number; persona: string | null; lang: AppLang | null };
const devices: Device[] = [
  { contactId: 10, persona: 'neutral', lang: 'ar' },
  { contactId: 11, persona: 'entrepreneur', lang: 'ar' },
  { contactId: 12, persona: 'investor', lang: 'en' },
];

function rig(events: AgendaEvent[], registrations: AgendaRegistration[] = []) {
  const sent: { device: Device; message: PushMessage }[] = [];
  const kv = new MemoryKV();
  const push = {
    async broadcastEach(choose: (device: Device) => Promise<PushMessage | null> | PushMessage | null) {
      let count = 0;
      for (const device of devices) {
        const message = await choose(device);
        if (message) {
          sent.push({ device, message });
          count += 1;
        }
      }
      return { sent: count, failed: 0, dropped: 0 };
    },
  };
  const agenda = {
    async upcomingOpen() {
      return events.filter((entry) => entry.open);
    },
    async registrations(eventId: string) {
      return registrations.filter((entry) => entry.eventId === eventId);
    },
  };
  return { service: new WorkshopNudgeService({ kv, log: silentLog, agenda, push }), sent, kv };
}

test('the slots: nothing before 09:00, the morning slot once, the evening slot once', async () => {
  const { service, sent } = rig([event({})]);
  assert.equal(slotOf(at(8)), null);
  assert.equal(await service.run(at(8)), null);
  assert.equal(sent.length, 0);

  const morning = await service.run(at(NUDGE_HOURS[0]));
  assert.ok(morning);
  assert.equal(morning.eventId, 'ev1');
  assert.equal(sent.length, 3, 'every device, every persona, both languages');
  assert.equal(await service.run(at(NUDGE_HOURS[0] + 3)), null, 'the morning slot is spent');
  assert.equal(sent.length, 3);

  const evening = await service.run(at(NUDGE_HOURS[1]));
  assert.ok(evening);
  assert.equal(sent.length, 6);
  assert.equal(await service.run(at(23)), null);
  // The next morning is a new slot.
  assert.ok(await service.run(at(NUDGE_HOURS[0], 1)));
  assert.equal(sent.length, 9);
});

test('every send uses a different wording, the push opens the event, and the fee line names the membership', async () => {
  const { service, sent } = rig([event({})]);
  for (let day = 0; day < 4; day += 1) {
    await service.run(at(NUDGE_HOURS[0], day));
    await service.run(at(NUDGE_HOURS[1], day));
  }
  const arabic = sent.filter((entry) => entry.device.lang === 'ar' && entry.device.contactId === 10).map((entry) => entry.message);
  assert.equal(arabic.length, 8);
  assert.equal(new Set(arabic.map((message) => message.title)).size, 8, 'eight sends, eight titles');
  assert.equal(new Set(arabic.map((message) => message.body)).size, 8);
  for (const message of arabic) {
    assert.deepEqual(message.data, { type: 'agenda', eventId: 'ev1', screen: '/agenda/ev1' });
    assert.match(message.body, /بدون رسوم/u);
    assert.match(message.body, /290 ريال/u);
    assert.ok(!/مجان/u.test(message.body), 'never «مجاني»');
  }
  const english = sent.filter((entry) => entry.device.lang === 'en').map((entry) => entry.message);
  assert.equal(new Set(english.map((message) => message.title)).size, 8);
  assert.match(english[0]!.body, /The AI workshop/u);
  assert.equal(TEMPLATES_AR.length, TEMPLATES_EN.length);
});

test('confirmed attendees are skipped; a closed or finished workshop is never nudged; several take turns', async () => {
  const soon = event({ id: 'soon', title: 'القريبة', date: plusDays(2) });
  const later = event({ id: 'later', title: 'البعيدة', date: plusDays(20) });
  const closed = event({ id: 'closed', title: 'المغلقة', open: false });
  const paid = { id: 'r1', eventId: 'soon', contactId: 11, name: 'عضو مؤكد', phone: '', email: '', personaLabel: '', attendance: 'hq', member: true, paid: true, paymentId: null, createdAt: '', confirmedAt: '' } as AgendaRegistration;
  const pending = { ...paid, id: 'r2', contactId: 12, paid: false, confirmedAt: null } as AgendaRegistration;
  const { service, sent } = rig([later, soon, closed], [paid, pending]);

  const first = await service.run(at(NUDGE_HOURS[0]));
  assert.equal(first?.eventId, 'soon', 'the soonest workshop first');
  assert.deepEqual(sent.map((entry) => entry.device.contactId), [10, 12], 'the confirmed attendee 11 is skipped, the unpaid 12 still hears');

  const second = await service.run(at(NUDGE_HOURS[1]));
  assert.equal(second?.eventId, 'later', 'then the other workshop takes its turn');
  const third = await service.run(at(NUDGE_HOURS[0], 1));
  assert.equal(third?.eventId, 'soon');
  assert.ok(!sent.some((entry) => entry.message.data?.eventId === 'closed'));
});

test('the switch stops the ticks, «send now» ignores the slots, the state survives in kv', async () => {
  const { service, sent, kv } = rig([event({})]);
  await service.setEnabled(false);
  assert.equal(await service.run(at(NUDGE_HOURS[0])), null);
  assert.equal(sent.length, 0);
  const forced = await service.sendNow(at(3));
  assert.equal(forced?.variant, 0);
  assert.equal(sent.length, 3);
  const state = await kv.get<NudgesState>(NUDGES_KEY);
  assert.equal(state?.enabled, false);
  assert.equal(state?.counts.ev1, 1);
  assert.equal(state?.lastSlot, null, 'a forced send leaves the slots alone');
});

test('the wording reads the calendar: today, tomorrow, a span of days', () => {
  const now = at(10);
  assert.match(nudgeMessage(event({ date: today }), 0, 'ar', now).body, /اليوم/u);
  assert.match(nudgeMessage(event({ date: plusDays(1) }), 0, 'ar', now).body, /غدًا/u);
  const span = nudgeMessage(event({ date: plusDays(3), dates: [plusDays(3), plusDays(4)], time: '' }), 0, 'ar', now).body;
  assert.match(span, /من .+ إلى /u);
  assert.ok(!/\d-\d/u.test(span), 'no hyphen between two numbers');
  assert.match(nudgeMessage(event({ date: plusDays(1) }), 1, 'en', now).title, /^tomorrow:/u);
});
