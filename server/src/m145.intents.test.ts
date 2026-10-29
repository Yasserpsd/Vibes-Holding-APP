import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IntentDetector } from './advisor/intents.js';
import type { Me } from './auth/service.js';
import { bookableDays, type HqService } from './hq/service.js';
import { MemoryKV } from './store.js';

// M145 «المساعد ينفّذ»: the model's answer is validated against the live catalog — days, free
// slots, purposes, services — and a pick from the card completes a pending booking without the model.

const log = { warn() {}, info() {}, error() {}, debug() {} } as unknown as ConstructorParameters<typeof IntentDetector>[0]['log'];
const ME = { id: 7, name: 'عضو النادي', membership: { status: 'active' } } as unknown as Me;

const CONTENT = {
  leadDays: 0,
  maxDaysAhead: 6,
  hours: { days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '17:00', slotMinutes: 60 },
  purposes: ['اجتماع عمل', 'جولة في المقر', 'استشارة'],
  slotCapacity: 3,
  walletHours: 24,
};

function fakeHq(taken: string[] = []): HqService {
  return {
    content: async () => CONTENT,
    slots: async (date: string) => ({
      date,
      slots: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'].map((time) => ({ time, endTime: time, available: !taken.includes(time) })),
    }),
  } as unknown as HqService;
}

function completion(answer: Record<string, unknown>) {
  const body = {
    intent: 'none',
    screen: '',
    serviceKey: '',
    answers: [],
    hq: { kind: '', hours: '', date: '', time: '', purpose: '', note: '' },
    reply: '',
    ...answer,
  };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const days = () => bookableDays(CONTENT as never, Date.now()).map((day) => day.date);

test('m145: a meeting-room booking with a free slot is ready to confirm; a taken slot is asked again', async () => {
  const day = days()[0] ?? '';
  let prompt = '';
  const fetchImpl: typeof fetch = async (_input, init) => {
    prompt = String(JSON.parse(String(init?.body)).messages[1].content);
    return completion({ intent: 'hq_book', hq: { kind: 'meeting', hours: '٢', date: day, time: '10:00', purpose: '', note: 'مع شريكي' }, reply: 'أبشر، حجزت لك القاعة.' });
  };
  const free = new IntentDetector({ apiKey: 'k', model: 'm', log, fetchImpl, hq: fakeHq(), kv: new MemoryKV() });
  const result = await free.detect({ text: 'احجز لي قاعة الاجتماعات بكرة الساعة 10 ساعتين', lang: 'ar', me: ME });
  assert.equal(result.action?.type, 'hq_book');
  if (result.action?.type !== 'hq_book') return;
  assert.deepEqual(result.action.proposal, { kind: 'meeting', hours: 2, date: day, time: '10:00', purpose: null, note: 'مع شريكي' });
  assert.deepEqual(result.action.missing, []);
  assert.equal(result.reply, 'أبشر، حجزت لك القاعة.');
  assert.ok(result.action.summary.some((line) => line.includes('قاعة الاجتماعات')));
  assert.ok(prompt.includes('Bookable days') && prompt.includes('pitch-deck'));

  const busy = new IntentDetector({ apiKey: 'k', model: 'm', log, fetchImpl, hq: fakeHq(['10:00']), kv: new MemoryKV() });
  const again = await busy.detect({ text: 'نفس الطلب', lang: 'ar', me: ME });
  assert.equal(again.action?.type, 'hq_book');
  if (again.action?.type !== 'hq_book') return;
  assert.equal(again.action.proposal.time, null);
  assert.deepEqual(again.action.missing, ['time']);
  assert.ok(!again.action.options.times.includes('10:00'));
});

test('m145: a visit needs its purpose; a card pick completes the pending booking without the model', async () => {
  const day = days()[0] ?? '';
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return completion({ intent: 'hq_book', hq: { kind: 'visit', hours: '', date: '2020-01-01', time: '25:00', purpose: 'جوله بالمقر', note: '' }, reply: '' });
  };
  const detector = new IntentDetector({ apiKey: 'k', model: 'm', log, fetchImpl, hq: fakeHq(), kv: new MemoryKV() });
  const first = await detector.detect({ text: 'أبغى أزور المقر', lang: 'ar', me: ME });
  assert.equal(first.action?.type, 'hq_book');
  if (first.action?.type !== 'hq_book') return;
  assert.equal(first.action.proposal.purpose, 'جولة في المقر'); // snapped to the real option
  assert.equal(first.action.proposal.date, null); // outside the bookable days
  assert.deepEqual(first.action.missing, ['date', 'time']);
  assert.match(first.reply ?? '', /اليوم/);

  const picked = await detector.detect({ text: '', lang: 'ar', me: ME, pending: { ...first.action.proposal, date: day, time: '11:00' } });
  assert.equal(calls, 1); // no model call for a bare pick
  assert.equal(picked.action?.type, 'hq_book');
  if (picked.action?.type !== 'hq_book') return;
  assert.deepEqual(picked.action.missing, []);
  assert.equal(picked.reply, 'جاهز، راجع الحجز واضغط تأكيد.');
});

test('m145: screens and services are validated; unknown ones and plain questions fall through', async () => {
  const make = (answer: Record<string, unknown>) => new IntentDetector({ apiKey: 'k', model: 'm', log, fetchImpl: async () => completion(answer), hq: fakeHq(), kv: new MemoryKV() });
  const screen = await make({ intent: 'open_screen', screen: 'card', reply: 'تفضل بطاقتك.' }).detect({ text: 'وريني بطاقتي', lang: 'ar', me: ME });
  assert.deepEqual(screen, { action: { type: 'screen', screen: 'card', label: 'بطاقة العضوية' }, reply: 'تفضل بطاقتك.' });

  const unknown = await make({ intent: 'open_screen', screen: 'settings' }).detect({ text: 'x', lang: 'ar', me: ME });
  assert.deepEqual(unknown, { action: null, reply: null });

  const service = await make({
    intent: 'service',
    serviceKey: 'pitch-deck',
    answers: [
      { key: 'project', value: 'تطبيق توصيل' },
      { key: 'stage', value: 'نموذج اولي' },
      { key: 'bogus', value: 'x' },
    ],
    reply: '',
  }).detect({ text: 'أبغى عرض تقديمي لمشروعي', lang: 'ar', me: ME });
  assert.equal(service.action?.type, 'service');
  if (service.action?.type !== 'service') return;
  assert.equal(service.action.key, 'pitch-deck');
  assert.deepEqual(service.action.answers, { project: 'تطبيق توصيل', stage: 'نموذج أولي' });
  assert.match(service.reply ?? '', /راجعه وأرسله/);

  const none = await make({ intent: 'none' }).detect({ text: 'وش رايك في العقار؟', lang: 'ar', me: ME });
  assert.deepEqual(none, { action: null, reply: null });

  const failing = new IntentDetector({ apiKey: 'k', model: 'm', log, fetchImpl: async () => new Response('x', { status: 500 }), hq: fakeHq(), kv: new MemoryKV() });
  assert.deepEqual(await failing.detect({ text: 'احجز', lang: 'ar', me: ME }), { action: null, reply: null });
});
