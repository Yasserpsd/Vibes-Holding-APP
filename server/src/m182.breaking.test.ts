import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BreakingNewsService, breakingMessage } from './news/breaking.js';
import { biggestFigure } from './news/service.js';
import { NewsPushCap } from './news/pushCap.js';
import type { NewsService } from './news/service.js';
import type { NewsItem } from './news/types.js';
import type { PushMessage, PushService } from './push/service.js';
import { MemoryKV } from './store.js';

const silentLog = { warn() {}, info() {}, error() {}, debug() {} } as never;

const item = (overrides: Partial<NewsItem>): NewsItem => ({
  id: 'x', sourceId: 's', sourceName: 'أرقام', tier: 'saudi', lang: 'ar', title: 'أرامكو تعلن أرباحًا قياسية بـ 120 مليار', snippet: null, url: 'u', image: null,
  publishedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), classifiedBy: 'keywords',
  topics: ['economy'], decision: false, businessAngle: true, relevance: 50, hidden: false, duplicateOf: null, ...overrides,
});

type Device = { contactId: number; lang: string | null };
const fakePush = (devices: Device[], sent: { to: number; message: PushMessage }[]): PushService =>
  ({
    broadcastEach: async (build: (device: Device) => PushMessage | null) => {
      for (const device of devices) {
        const message = build(device);
        if (message) sent.push({ to: device.contactId, message });
      }
      return { sent: sent.length };
    },
  }) as unknown as PushService;

const newsWith = (ar: NewsItem[], en: NewsItem[] = [], pushCap = new NewsPushCap(new MemoryKV())): NewsService =>
  ({ breaking: (lang: string) => (lang === 'en' ? en : ar), pushCap }) as unknown as NewsService;

// 11:00 Riyadh (08:00 UTC) — outside the quiet hours; 23:30 Riyadh is inside them.
const DAY_MS = Date.parse('2026-11-02T08:00:00.000Z');
const NIGHT_MS = Date.parse('2026-11-02T20:30:00.000Z');

test('M182c: the biggest figure wins — scale words beat percentages, Arabic digits read fine', () => {
  assert.equal(biggestFigure('أرامكو تحقق 120 مليار ريال وقيمتها 1.8 تريليون')?.text, '1.8 تريليون');
  assert.equal(biggestFigure('السهم يقفز 40% بعد صفقة بـ 500 مليون')?.text, '500 مليون');
  assert.equal(biggestFigure('المؤشر يرتفع ٣٥٪')?.text, '٣٥٪');
  assert.equal(biggestFigure('خبر بلا أرقام'), null);
});

test('M182b: the push carries the source name and its own headline, and opens the item', () => {
  const message = breakingMessage(item({ id: 'n1' }));
  assert.ok(message.title.includes('عاجل') && message.title.includes('أرقام'));
  assert.equal(message.body, 'أرامكو تعلن أرباحًا قياسية بـ 120 مليار');
  assert.equal(message.data?.screen, '/news/n1');
  const english = breakingMessage(item({ id: 'n2', lang: 'en', sourceName: 'Argaam', title: 'Aramco posts record profit' }));
  assert.ok(english.title.includes('Breaking') && !/[؀-ۿ]/u.test(`${english.title}${english.body}`));
});

test('M182b: one wave per tick in each language, once per item, capped per day, silent at night', async () => {
  const kv = new MemoryKV();
  const sent: { to: number; message: PushMessage }[] = [];
  const devices = [
    { contactId: 1, lang: 'ar' },
    { contactId: 2, lang: 'en' },
  ];
  const arA = item({ id: 'a1' });
  const enA = item({ id: 'e1', lang: 'en', sourceName: 'Reuters', title: 'Oil surges to a record' });
  let service = new BreakingNewsService({ kv, log: silentLog, news: newsWith([arA], [enA]), push: fakePush(devices, sent), enabled: true });

  assert.equal(await service.tick(NIGHT_MS), false, 'quiet hours send nothing');

  assert.equal(await service.tick(DAY_MS), true);
  assert.equal(sent.length, 2, 'each device got the pick of its language');
  assert.equal(sent.find((entry) => entry.to === 2)?.message.data?.screen, '/news/e1');

  assert.equal(await service.tick(DAY_MS + 5 * 60_000), false, 'the same items never send twice');

  // M219: one breaking wave a day — a second fresh story waits for tomorrow.
  service = new BreakingNewsService({ kv, log: silentLog, news: newsWith([item({ id: 'a3' })]), push: fakePush(devices, sent), enabled: true });
  assert.equal(await service.tick(DAY_MS + 20 * 60_000), false, 'the daily cap holds');
  assert.equal(await service.tick(DAY_MS + 24 * 3_600_000), true, 'a new Riyadh day starts fresh');

  // M219: breaking shares the day's budget of two news pushes with the editions — a full day sends nothing.
  const cap = new NewsPushCap(new MemoryKV());
  const fullDay = DAY_MS + 48 * 3_600_000;
  assert.equal(await cap.take(fullDay), true);
  assert.equal(await cap.take(fullDay), true);
  assert.equal(await cap.take(fullDay), false, 'the third news push of a day is refused');
  const capped = new BreakingNewsService({ kv, log: silentLog, news: newsWith([item({ id: 'a7' })], [], cap), push: fakePush(devices, sent), enabled: true });
  assert.equal(await capped.tick(fullDay), false, 'two news pushes already went out today');

  const off = new BreakingNewsService({ kv, log: silentLog, news: newsWith([item({ id: 'a9' })]), push: fakePush(devices, sent), enabled: false });
  assert.equal(await off.tick(DAY_MS + 25 * 3_600_000), false, 'NEWS_BREAKING=0 kills it');
});
