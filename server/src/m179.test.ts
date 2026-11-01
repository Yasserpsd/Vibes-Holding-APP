import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ContextResolver } from './advisor/context.js';
import { ALERT_DEFAULTS, alertMessage, MarketAlertsService } from './markets/alerts.js';
import type { MarketQuote, MarketsAnswer } from './markets/service.js';
import type { AppLang } from './lang.js';
import type { PushMessage } from './push/service.js';
import { riyadhDay, riyadhDayStart } from './riyadh.js';
import { MemoryKV } from './store.js';

// M179: the advisor pushes when a quote moves sharply — owner thresholds, fresh quotes only, once per quote a
// day, a daily cap, quiet hours, muted members skipped, TASI always says it is 15 minutes late.

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return silentLog; } } as unknown as import('fastify').FastifyBaseLogger;

const today = riyadhDay(Date.now());
const at = (hour: number) => riyadhDayStart(today) + hour * 3_600_000 + 60_000;
const NOON = at(12);

const quote = (overrides: Partial<MarketQuote>): MarketQuote => ({
  key: 'gold',
  group: 'metals',
  label: 'الذهب',
  labelEn: 'Gold',
  unit: 'دولار/أونصة',
  unitEn: 'USD/oz',
  price: 2650.5,
  changePct: 0.4,
  at: new Date(NOON - 60_000).toISOString(),
  ...overrides,
});

type Device = { contactId: number; lang: AppLang | null };
const devices: Device[] = [
  { contactId: 1, lang: 'ar' },
  { contactId: 2, lang: 'en' },
  { contactId: 3, lang: 'ar' },
];

function rig(quotes: MarketQuote[], mutedIds: number[] = []) {
  const kv = new MemoryKV();
  const sent: { device: Device; message: PushMessage }[] = [];
  const answer: MarketsAnswer = { quotes, source: 'Yahoo Finance', updatedAt: null };
  const service = new MarketAlertsService({
    kv,
    log: silentLog,
    enabled: true,
    markets: { quotes: async () => answer } as never,
    push: {
      async broadcastEach(choose: (device: Device) => PushMessage | null) {
        for (const device of devices) {
          const message = choose(device);
          if (message) sent.push({ device, message });
        }
        return { sent: sent.length, failed: 0, dropped: 0 };
      },
    } as never,
    muted: async () => new Set(mutedIds),
  });
  return { service, sent, answer, kv };
}

test('a sharp move sends one alert with the feed numbers and the disclaimer, in each device language', async () => {
  const { service, sent } = rig([quote({ changePct: -3.4 }), quote({ key: 'silver', label: 'الفضة', changePct: 1 })]);
  assert.equal(await service.tick(NOON), 1);
  assert.equal(sent.length, 3);
  const arabic = sent.find((entry) => entry.device.contactId === 1)!.message;
  assert.match(arabic.title, /المستشار: الذهب انخفض 3.4%/);
  assert.match(arabic.body, /2,650.5/);
  assert.match(arabic.body, /للاطلاع فقط وليست توصية استثمارية/);
  assert.doesNotMatch(arabic.body + arabic.title, /مجان/);
  const english = sent.find((entry) => entry.device.contactId === 2)!.message;
  assert.match(english.title, /Advisor: Gold dropped 3.4%/);
  assert.match(english.body, /not investment advice/);
  assert.equal(arabic.data?.type, 'market-alert');
  assert.match(arabic.data?.screen ?? '', /^\/advisor\?.*ctxId=markets/);
});

test('below the group threshold nothing is sent; the owner can change the threshold', async () => {
  const { service, sent } = rig([quote({ changePct: 2.5 })]);
  assert.equal(await service.tick(NOON), 0);
  await service.save({ thresholds: { ...ALERT_DEFAULTS.thresholds, metals: 2 } });
  assert.equal(await service.tick(NOON), 1);
  assert.ok(sent.length > 0);
});

test('one alert per quote per day, and a daily cap', async () => {
  const movers = ['gold', 'silver', 'brent', 'wti'].map((key) => quote({ key, label: key, changePct: 5 }));
  const { service, answer } = rig(movers);
  assert.equal(await service.tick(NOON), 3);
  assert.equal(await service.tick(NOON + 60_000), 0);
  // The next Riyadh day starts fresh (with fresh quotes).
  const tomorrow = NOON + 86_400_000;
  answer.quotes = answer.quotes.map((entry) => ({ ...entry, at: new Date(tomorrow - 60_000).toISOString() }));
  assert.equal(await service.tick(tomorrow), 3);
});

test('closed markets with a stale quote are never alerted', async () => {
  const { service } = rig([quote({ changePct: 6, at: new Date(NOON - 5 * 3_600_000).toISOString() })]);
  assert.equal(await service.tick(NOON), 0);
});

test('quiet hours and the off switch send nothing', async () => {
  const night = at(2);
  const { service } = rig([quote({ changePct: 6, at: new Date(night - 60_000).toISOString() })]);
  assert.equal(await service.tick(night), 0);
  await service.save({ enabled: false });
  assert.equal(await service.tick(NOON), 0);
});

test('members who muted the advisor get nothing', async () => {
  const { service, sent } = rig([quote({ changePct: 4 })], [1, 3]);
  await service.tick(NOON);
  assert.deepEqual(sent.map((entry) => entry.device.contactId), [2]);
});

test('TASI alerts say the data is 15 minutes late, and a fresh-enough delayed quote still counts', async () => {
  const tasi = quote({ key: 'tasi', group: 'stocks', label: 'السوق السعودي', labelEn: 'Saudi Market', unit: 'تاسي · نقطة', unitEn: 'TASI · pts', delayedMin: 15, changePct: -2.6, price: 11850.2, at: new Date(NOON - 40 * 60_000).toISOString() });
  const { service, sent } = rig([tasi]);
  assert.equal(await service.tick(NOON), 1);
  assert.match(sent[0]!.message.body, /متأخرة 15 دقيقة/);
  const english = alertMessage({ quote: tasi, direction: 'down', threshold: 2 }, 'en', NOON);
  assert.match(english.body, /15 minutes delayed/);
});

test('the markets screen context carries the live numbers, the delay and no forecast request', async () => {
  const resolver = new ContextResolver({ markets: { quotes: async () => ({ quotes: [quote({ key: 'tasi', label: 'السوق السعودي', delayedMin: 15, changePct: 1.2 })], source: 'Yahoo Finance', updatedAt: null }) } } as never);
  const found = await resolver.resolve({ type: 'screen', id: 'markets' }, 'ar');
  assert.match(found.focus?.text ?? '', /السوق السعودي: 2650.5/);
  assert.match(found.focus?.text ?? '', /متأخرة 15 دقيقة/);
  assert.match(found.focus?.text ?? '', /ليست توصية استثمارية/);
});
