import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MockHubClient } from '../hub/mock.js';
import { MemoryKV } from '../store.js';
import { classifyByKeywords, mentionsSaudi } from './classify.js';
import { NEWS_SEED_VERSION, NEWS_SOURCES_KEY, NEWS_SOURCES_SEED, mergeSeed, outletNameFor } from './sources.js';
import { newsIdOf } from './service.js';
import type { NewsSourcesContent } from './types.js';

/** M27: the English version reads English sources only, as they wrote them (rule 7). */

const now = new Date().toUTCString();
const FEED_AR = `<rss version="2.0"><channel>
<item><title>شركة ناشئة سعودية تغلق جولة تمويل بقيمة 50 مليون ريال</title><link>https://ar.test/startup</link><description>تمويل</description><pubDate>${now}</pubDate></item>
</channel></rss>`;
const FEED_GLOBAL = `<rss version="2.0"><channel>
<item><title>Saudi Arabia's PIF invests $2 billion in AI startup</title><link>https://global.test/pif</link><description>The fund expands its technology bets.</description><pubDate>${now}</pubDate></item>
<item><title>Federal Reserve holds interest rates steady</title><link>https://global.test/fed</link><description>US markets were flat.</description><pubDate>${now}</pubDate></item>
</channel></rss>`;
const FEED_SAUDI_EN = `<rss version="2.0"><channel>
<item><title>Cabinet approves new investment law</title><link>https://saudi-en.test/cabinet</link><description>RIYADH: The Saudi Cabinet approved the law on Tuesday.</description><pubDate>${now}</pubDate></item>
</channel></rss>`;
const SPA_API = 'https://portalapi.spa.gov.sa/api/v1/news';
const spaRow = (uuid: string, locale: string, title: string) => ({ uuid, locale, title, published_at: Math.floor(Date.now() / 1000), image: null });

const fetched: { url: string; lang: string }[] = [];
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const lang = String((init?.headers as Record<string, string> | undefined)?.['accept-language'] ?? '');
  fetched.push({ url, lang });
  const xml = (body: string) => new Response(body, { headers: { 'content-type': 'application/rss+xml' } });
  if (url === 'https://feed.test/ar') return xml(FEED_AR);
  if (url === 'https://feed.test/global') return xml(FEED_GLOBAL);
  if (url === 'https://feed.test/saudi-en') return xml(FEED_SAUDI_EN);
  // The English list also carries a row of the Arabic wire, as the agency's cache sometimes answers: it is skipped.
  if (url === `${SPA_API}?category_id=3&per_page=30&locale=en`) return Response.json({ data: [spaRow('N9', 'en', 'Saudi Non-Oil Exports Rise 12% in the Second Quarter'), spaRow('N7', 'ar', 'اقتصادي / خبر من النشرة العربية')] });
  if (url === `${SPA_API}?category_id=3&per_page=30&locale=ar`) return Response.json({ data: [spaRow('N8', 'ar', 'اقتصادي / ارتفاع الصادرات غير النفطية 12% في الربع الثاني')] });
  if (url === `${SPA_API}/N9`) return Response.json({ data: { content: '<p>Riyadh, September 21, 2026, SPA -- Non-oil exports rose 12% in the second quarter, the statistics authority said.</p>' } });
  if (url === `${SPA_API}/N8`) return Response.json({ data: { content: '<p>الرياض 09 ربيع الآخر 1448 هـ واس</p><p>ارتفعت الصادرات غير النفطية 12% في الربع الثاني.</p>' } });
  if (/^https:\/\/(ar|global|saudi-en)\.test\/|^https:\/\/www\.spa\.gov\.sa\//.test(url)) {
    return new Response('<html><head><meta property="og:description" content="page text"></head></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  throw new Error(`unexpected fetch ${url}`);
};

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', NEWS_REFRESH_MINUTES: '0' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let news: Awaited<ReturnType<typeof buildApp>>['news'];

before(async () => {
  await kv.set(NEWS_SOURCES_KEY, {
    sources: [
      { id: 'ar', name: 'مصدر عربي', url: 'https://feed.test/ar', tier: 'saudi', lang: 'ar', enabled: true, hint: null },
      { id: 'spa-ar', name: 'واس', url: `${SPA_API}?category_id=3&per_page=30&locale=ar`, tier: 'official', lang: 'ar', enabled: true, hint: null },
      { id: 'spa-en', name: 'SPA', url: `${SPA_API}?category_id=3&per_page=30&locale=en`, tier: 'official', lang: 'en', enabled: true, hint: null },
      { id: 'global', name: 'Global Wire', url: 'https://feed.test/global', tier: 'global', lang: 'en', enabled: true, hint: null, saudiOnly: true },
      { id: 'saudi-en', name: 'Saudi Daily', url: 'https://feed.test/saudi-en', tier: 'saudi', lang: 'en', enabled: true, hint: null },
    ],
    updatedAt: '2026-09-22T00:00:00.000Z',
    seedVersion: NEWS_SEED_VERSION,
  } satisfies NewsSourcesContent);
  const built = await buildApp({ config, kv, hub: new MockHubClient(), fetchImpl: fakeFetch });
  app = built.app;
  news = built.news;
  await news.start();
  await news.refresh();
});

after(async () => {
  await app.close();
});

test('a foreign English outlet is read for its Saudi stories only', () => {
  assert.ok(fetched.some((call) => call.url === 'https://global.test/pif'));
  assert.ok(!fetched.some((call) => call.url === 'https://global.test/fed'), 'a story without Saudi Arabia never costs a page fetch');
  assert.equal(news.status().visibleByLang.en, 3);
  assert.equal(news.status().visibleByLang.ar, 2);
  assert.ok(mentionsSaudi('Aramco raises output', null, 'global'));
  assert.ok(mentionsSaudi('Non-oil exports rise', 'RIYADH: The Kingdom said on Monday.', 'saudi'));
  assert.ok(!mentionsSaudi('United Kingdom raises taxes', null, 'saudi'));
  assert.ok(!mentionsSaudi('Jordan: the Kingdom raises taxes', null, 'global'), 'abroad «the Kingdom» is not Saudi Arabia');
  assert.ok(!mentionsSaudi('AI will shape Lebanon', `${'Beirut said so. '.repeat(20)} Related: Saudi Arabia.`, 'global'), 'a mention deep in a full-text feed does not count');
});

test('each language gets its own feed, labels and decisions title', async () => {
  const arabic = await app.inject({ method: 'GET', url: '/api/news/feed' });
  assert.deepEqual(arabic.json().items.map((item: { lang: string }) => item.lang), ['ar', 'ar']);

  const english = await app.inject({ method: 'GET', url: '/api/news/feed?lang=en' });
  assert.equal(english.json().total, 3);
  assert.ok(english.json().items.every((item: { lang: string }) => item.lang === 'en'));
  const pif = english.json().items.find((item: { url: string }) => item.url === 'https://global.test/pif');
  assert.equal(pif.title, "Saudi Arabia's PIF invests $2 billion in AI startup", 'the source title, untouched');
  assert.equal(pif.source.tierLabel, 'International media');
  assert.ok(pif.topics.some((topic: { key: string; label: string }) => topic.key === 'tech' && topic.label === 'Technology & AI'));

  assert.equal(english.json().items[0].url, 'https://global.test/pif', 'foreign outlets lead the English feed');

  const byHeader = await app.inject({ method: 'GET', url: '/api/news/feed', headers: { 'x-app-lang': 'en' } });
  assert.equal(byHeader.json().total, 3, 'the app sends its language in a header');
  const browser = await app.inject({ method: 'GET', url: '/api/news/feed', headers: { 'accept-language': 'en-US,en;q=0.9' } });
  assert.deepEqual(browser.json().items.map((item: { lang: string }) => item.lang), ['ar', 'ar'], 'a browser language never switches the feed');

  const topics = await app.inject({ method: 'GET', url: '/api/news/topics?lang=en' });
  assert.equal(topics.json().decisionsTitle, 'Saudi Decisions & Regulations');
  assert.equal(topics.json().topics[0].label, 'Economy & Business');
  assert.equal((await app.inject({ method: 'GET', url: '/api/news/topics' })).json().topics[0].label, 'الاقتصاد والأعمال');

  const decisions = await app.inject({ method: 'GET', url: '/api/news/decisions?lang=en' });
  assert.deepEqual(decisions.json().items.map((item: { url: string }) => item.url), ['https://saudi-en.test/cabinet']);
});

test('the SPA English wire: its own page, language header and dateline', async () => {
  const item = (await app.inject({ method: 'GET', url: `/api/news/${newsIdOf('https://www.spa.gov.sa/en/N9')}` })).json().item;
  assert.equal(item.source.name, 'SPA');
  assert.equal(item.source.tierLabel, 'Official source');
  assert.equal(item.snippet, 'Non-oil exports rose 12% in the second quarter, the statistics authority said.');
  assert.ok(fetched.some((call) => call.url === `${SPA_API}/N9` && call.lang === 'en'));
  const arabic = (await app.inject({ method: 'GET', url: `/api/news/${newsIdOf('https://www.spa.gov.sa/ar/N8')}` })).json().item;
  assert.equal(arabic.title, 'ارتفاع الصادرات غير النفطية 12% في الربع الثاني');
  assert.equal(arabic.snippet, 'ارتفعت الصادرات غير النفطية 12% في الربع الثاني.');
});

test('an outlet keeps its English name in the English feed', () => {
  assert.equal(outletNameFor('https://www.bbc.co.uk/news/articles/x', 'BBC News', 'en'), 'BBC');
  assert.equal(outletNameFor('https://www.bbc.co.uk/arabic/x', 'BBC', 'ar'), 'BBC عربي');
});

test('«United Kingdom» is not «the Kingdom»', () => {
  const uk = classifyByKeywords({ id: '1', title: 'United Kingdom approves new tax law', snippet: null, source: 'Global Wire', tier: 'global', lang: 'en', hint: null });
  assert.equal(uk.decision, false);
  const ksa = classifyByKeywords({ id: '2', title: 'Kingdom approves new investment law', snippet: 'The Saudi ministry said.', source: 'Saudi Daily', tier: 'saudi', lang: 'en', hint: null });
  assert.equal(ksa.decision, true);
});

test('a newer seed adds its rows to a stored list and keeps the edits made on it', () => {
  const stored: NewsSourcesContent = {
    sources: NEWS_SOURCES_SEED.filter((row) => row.lang === 'ar' || row.id === 'arabnews').map((row) => ({ ...row, url: row.url.replace(/&locale=ar$/, ''), enabled: row.id === 'okaz-economy' || row.id === 'arabnews' ? false : row.enabled })),
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
  const merged = mergeSeed(stored);
  assert.ok(merged);
  assert.equal(merged.seedVersion, NEWS_SEED_VERSION);
  assert.equal(merged.sources.find((row) => row.id === 'okaz-economy')?.enabled, false, 'an edit stays');
  assert.deepEqual([merged.sources.find((row) => row.id === 'arabnews')?.enabled, merged.sources.find((row) => row.id === 'arabnews')?.saudiOnly], [true, true], 'turned on by this revision, for its Saudi stories');
  assert.equal(merged.sources.find((row) => row.id === 'cnbc-saudi')?.enabled, true);
  assert.equal(merged.sources.find((row) => row.id === 'reuters-saudi')?.enabled, false, 'pages that refuse the server stay off');
  assert.match(merged.sources.find((row) => row.id === 'spa-economy')?.url ?? '', /&locale=ar$/, 'each SPA wire gets its own URL');
  assert.match(merged.sources.find((row) => row.id === 'spa-en-economy')?.url ?? '', /&locale=en$/);
  assert.equal(new Set(merged.sources.map((row) => row.id)).size, merged.sources.length);
  assert.equal(mergeSeed(merged), null, 'runs once');
});
