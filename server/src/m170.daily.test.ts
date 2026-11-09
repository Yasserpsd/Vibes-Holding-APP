import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AppLang } from './lang.js';
import { DAILY_PROJECT_HOURS, DAILY_PROJECT_KEY, DailyProjectService, type DailyProjectState, messageOf } from './projectsBank/daily.js';
import type { PublicProject } from './projectsBank/types.js';
import type { PushMessage } from './push/service.js';
import { riyadhDayStart, riyadhDay } from './riyadh.js';
import { MemoryKV } from './store.js';

const NOON = DAILY_PROJECT_HOURS[0];
const EVENING = DAILY_PROJECT_HOURS[1];

// M170 «مشروع اليوم»: one project of the Projects Bank a day, chosen by the model (or the rules), pushed to every
// device at/after 12:00 Riyadh with the public fields only — never twice, never a founder's contact.

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return silentLog; } } as unknown as import('fastify').FastifyBaseLogger;

const project = (overrides: Partial<PublicProject>): PublicProject => ({
  id: 1,
  number: null,
  slug: null,
  title: 'مشروع',
  titleEn: null,
  companyName: null,
  companyNameEn: null,
  founderName: null,
  founderNameEn: null,
  excerpt: null,
  excerptEn: null,
  details: null,
  detailsEn: null,
  image: null,
  gallery: [],
  sector: null,
  stage: null,
  isGolden: false,
  featuredOrder: null,
  goldenPartnerUrl: null,
  hasPitchDeck: false,
  contactRule: null,
  viewsCount: 0,
  modifiedAt: null,
  ...overrides,
});

const TECH = { slug: 'tech', name: 'تقنية' };
const clinics = project({
  id: 1,
  title: 'منصة حجوزات العيادات',
  titleEn: 'Clinic booking platform',
  sector: TECH,
  image: 'https://img/1.jpg',
  viewsCount: 900,
  excerpt: 'منصة تربط المرضى بالعيادات في 3 مدن. للتواصل واتساب 0501234567 أو clinic@example.com',
  details: 'منصة تربط المرضى بالعيادات وتعمل في 3 مدن مع 120 عيادة، باشتراك شهري للعيادات. '.repeat(4),
});
const doctors = project({ id: 2, title: 'تطبيق مواعيد الأطباء', sector: TECH, image: 'https://img/2.jpg', viewsCount: 500, excerpt: 'تطبيق يحجز مواعيد الأطباء للمرضى.' });
const farm = project({ id: 3, title: 'مزرعة عضوية', sector: { slug: 'agri', name: 'زراعة' }, viewsCount: 2000, excerpt: 'مزرعة خضار عضوية تبيع للمطاعم.' });
const all = [clinics, doctors, farm];

type Device = { contactId: number; persona: string | null; lang: AppLang | null };
const devices: Device[] = [
  { contactId: 10, persona: 'neutral', lang: 'ar' },
  { contactId: 11, persona: 'entrepreneur', lang: 'ar' },
  { contactId: 12, persona: 'investor', lang: 'en' },
];

function rig(options: { apiKey?: string; answer?: unknown; projects?: PublicProject[]; devices?: Device[] } = {}) {
  const sent: { device: Device; message: PushMessage }[] = [];
  const calls: unknown[] = [];
  const kv = new MemoryKV();
  const pool = options.projects ?? all;
  const push = {
    async broadcastEach(choose: (device: Device) => Promise<PushMessage | null> | PushMessage | null) {
      for (const device of options.devices ?? devices) {
        const message = await choose(device);
        if (message) sent.push({ device, message });
      }
      return { sent: sent.length, failed: 0, dropped: 0 };
    },
  };
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(options.answer ?? { id: 2, reason: 'فكرة واضحة' }) } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const service = new DailyProjectService({
    kv,
    log: silentLog,
    projects: { all: () => pool, get: (id) => pool.find((entry) => entry.id === id) ?? null },
    push,
    apiKey: options.apiKey,
    model: 'test',
    fetchImpl,
  });
  return { service, sent, calls, kv };
}

const today = riyadhDay(Date.now());
const at = (hour: number, dayOffset = 0) => riyadhDayStart(today) + dayOffset * 86_400_000 + hour * 3_600_000;

test('nothing goes out before the hour; at the hour every device gets one push that opens the project screen', async () => {
  const { service, sent, kv } = rig();
  assert.equal(await service.run(at(NOON - 1)), null);
  assert.equal(sent.length, 0);

  const result = await service.run(at(NOON));
  assert.ok(result);
  // Without a key the rules choose: pictured + described projects first, then the most viewed.
  assert.equal(result.projectId, 1);
  assert.equal(sent.length, 3, 'neutral, entrepreneur and investor alike');
  assert.deepEqual(new Set(sent.map((entry) => entry.device.persona)), new Set(['neutral', 'entrepreneur', 'investor']));
  for (const { message } of sent) {
    assert.equal(message.data?.screen, '/project/1');
    assert.equal(message.data?.type, 'project');
  }
  const arabic = sent.find((entry) => entry.device.lang === 'ar')!.message;
  const english = sent.find((entry) => entry.device.lang === 'en')!.message;
  assert.equal(arabic.title, 'مشروع اليوم من بنك المشاريع');
  assert.match(arabic.body, /منصة حجوزات العيادات · تقنية/);
  assert.match(english.body, /Clinic booking platform/);

  const state = (await kv.get<DailyProjectState>(DAILY_PROJECT_KEY))!;
  assert.equal(state.day, today);
  assert.ok(state.pushedAt);
  assert.deepEqual(state.recentIds, [1]);

  // The same day again: silence.
  assert.equal(await service.run(at(NOON + 3)), null);
  assert.equal(sent.length, 3);
});

test('the founder\'s contact data never leaves in the push body (rule 4)', () => {
  for (const lang of ['ar', 'en'] as const) {
    const message = messageOf(clinics, lang);
    assert.doesNotMatch(message.body, /example\.com|0501234567/);
    assert.match(message.body, /منصة تربط المرضى|Clinic booking/);
  }
});

test('the next day picks a project not shown lately; a forced send goes out again today with a fresh pick', async () => {
  const { service, sent } = rig();
  const first = await service.run(at(NOON));
  const second = await service.run(at(NOON, 1));
  assert.ok(first && second);
  assert.notEqual(second.projectId, first.projectId);
  assert.equal(sent.length, 6);

  const forced = await service.sendNow(at(NOON + 1, 1));
  assert.ok(forced);
  assert.notEqual(forced.projectId, second.projectId);
  assert.notEqual(forced.projectId, first.projectId);
  assert.equal(sent.length, 9);

  // Every project shown once: the rotation starts over instead of falling silent.
  const again = await service.run(at(NOON, 2));
  assert.ok(again);
});

test('with a key the model chooses one id of the shortlist; an id outside it falls back to the rules', async () => {
  const chosen = rig({ apiKey: 'sk-test-0123456789abcdef', answer: { id: 2, reason: 'فكرة واضحة' } });
  const result = await chosen.service.run(at(NOON));
  assert.equal(result?.projectId, 2);
  assert.equal(result?.reason, 'فكرة واضحة');
  const payload = chosen.calls[0] as { messages: { content: string }[] };
  const shortlist = JSON.parse(payload.messages[1]!.content) as { projects: { id: number; excerpt: string }[] };
  assert.deepEqual(shortlist.projects.map((entry) => entry.id).sort(), [1, 2, 3]);
  assert.doesNotMatch(JSON.stringify(shortlist), /example\.com|0501234567/, 'the model never sees a contact either');

  const wrong = rig({ apiKey: 'sk-test-0123456789abcdef', answer: { id: 999 } });
  const fallback = await wrong.service.run(at(NOON));
  assert.equal(fallback?.projectId, 1);
  assert.equal(fallback?.reason, null);
});

test('the switch off keeps the day silent; a pick that reached nobody is retried on the next tick', async () => {
  const off = rig();
  await off.service.setEnabled(false);
  assert.equal(await off.service.run(at(NOON)), null);
  assert.equal(off.sent.length, 0);

  const nobody = rig({ devices: [] });
  const first = await nobody.service.run(at(NOON));
  assert.equal(first?.sent, 0);
  const state = (await nobody.kv.get<DailyProjectState>(DAILY_PROJECT_KEY))!;
  assert.equal(state.pushedAt, null);
  // Still today, the same pick is tried again (no second project is burned).
  const retry = await nobody.service.run(at(NOON + 1));
  assert.equal(retry?.projectId, first?.projectId);
});

// M222: two projects a day — a golden one at noon, one of the rest of the bank in the evening, never a third.
const goldenA = project({ id: 7, title: 'مشروع ذهبي أول', isGolden: true, image: 'https://img/7.jpg', excerpt: 'مشروع ذهبي.' });
const goldenB = project({ id: 8, title: 'مشروع ذهبي ثان', isGolden: true, excerpt: 'مشروع ذهبي آخر.' });

test('M222: noon carries a golden project, the evening one of the rest, and the day stops at two', async () => {
  const { service, sent } = rig({ projects: [...all, goldenA, goldenB], devices: [devices[0]!] });
  const noon = await service.run(at(NOON));
  assert.equal(noon?.projectId, 7);
  assert.equal(sent[0]?.message.title, 'مشروع ذهبي من بنك المشاريع');
  assert.equal(await service.run(at(NOON + 3)), null);

  const evening = await service.run(at(EVENING));
  assert.ok(evening);
  assert.ok(![7, 8].includes(evening.projectId), 'the evening project comes from the rest of the bank');
  assert.equal(sent[1]?.message.title, 'مشروع اليوم من بنك المشاريع');
  assert.equal(await service.run(at(23)), null);
  assert.equal(sent.length, 2);

  // The next noon moves to the other golden project; the rest of the golden list keeps its place in the rotation.
  assert.equal((await service.run(at(NOON, 1)))?.projectId, 8);
  assert.equal((await service.run(at(NOON, 2)))?.projectId, 7, 'all golden shown: the one shown longest ago returns');
});

test('M222: with no golden project the noon slot still sends one of the bank', async () => {
  const { service } = rig();
  assert.equal((await service.run(at(NOON)))?.projectId, 1);
});

test('M222: a day whose noon push ran before the deploy sends only the evening one', async () => {
  const { service, sent, kv } = rig({ devices: [devices[0]!] });
  await kv.set(DAILY_PROJECT_KEY, { day: today, projectId: 1, pushedAt: new Date().toISOString(), reason: null, recentIds: [1], enabled: true });
  assert.equal(await service.run(at(NOON + 2)), null);
  assert.equal(sent.length, 0);
  assert.ok(await service.run(at(EVENING)));
  assert.equal(sent.length, 1);
});
