import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MockHubClient } from '../hub/mock.js';
import { MemoryKV } from '../store.js';
import { classifyByKeywords } from './classify.js';
import { findDuplicate, similarity, titleTokens } from './dedupe.js';
import { extractMeta } from './page.js';
import { canonicalUrl, parseFeed } from './rss.js';
import { NEWS_SOURCES_KEY } from './sources.js';
import { newsIdOf } from './service.js';
import { parseSpaList } from './spa.js';
import type { NewsItem, NewsSourcesContent } from './types.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:News="https://www.bing.com/news/search">
<channel><title>عكاظ</title>
<item><title><![CDATA[«ستاندرد آند بورز» تؤكد تصنيف المملكة عند A+]]></title>
<link><![CDATA[https://www.okaz.com.sa/economy/na/2265550?utm_source=rss]]></link>
<description><![CDATA[<p>أكدت وكالة التصنيف &laquo;ستاندرد آند بورز&raquo; تصنيف المملكة.</p><img src="https://www.okaz.com.sa/img/1.jpg">]]></description>
<pubDate>Sat, 12 Sep 2026 01:30:00 +0300</pubDate>
<media:thumbnail url="https://www.okaz.com.sa/thumb/1.jpg" /></item>
<item><title>اقتصادي / مجلس الوزراء يوافق على نظام الاستثمار</title>
<link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=1&amp;url=https%3a%2f%2fwww.spa.gov.sa%2fN2365197&amp;c=1&amp;mkt=ar-sa</link>
<description>الرياض واس وافق مجلس الوزراء ...</description>
<pubDate>Mon, 21 Jul 2025 17:00:00 GMT</pubDate>
<News:Source>وكالة الأنباء السعودية</News:Source></item>
<item><title>بدون رابط</title><description>x</description></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>t</title>
<entry><title>Atom item</title><link rel="alternate" href="https://example.com/a?fbclid=1#x"/><summary>S</summary><published>2026-09-11T10:00:00Z</published></entry>
</feed>`;

test('parses RSS with CDATA, tracking parameters and Bing redirect links', () => {
  const entries = parseFeed(RSS);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.title, '«ستاندرد آند بورز» تؤكد تصنيف المملكة عند A+');
  assert.equal(entries[0]?.url, 'https://www.okaz.com.sa/economy/na/2265550');
  assert.equal(entries[0]?.summary, 'أكدت وكالة التصنيف «ستاندرد آند بورز» تصنيف المملكة.');
  assert.equal(entries[0]?.image, 'https://www.okaz.com.sa/thumb/1.jpg');
  assert.equal(entries[0]?.publishedAt, '2026-09-11T22:30:00.000Z');
  assert.equal(entries[1]?.url, 'https://www.spa.gov.sa/N2365197');
  assert.equal(entries[1]?.sourceName, 'وكالة الأنباء السعودية');
});

test('parses Atom and canonicalizes URLs', () => {
  const entries = parseFeed(ATOM);
  assert.equal(entries[0]?.url, 'https://example.com/a');
  assert.equal(canonicalUrl('ftp://x'), null);
  assert.equal(canonicalUrl('https://a.b/c?utm_medium=x&id=2'), 'https://a.b/c?id=2');
});

test('parses the SPA portal list and strips the desk prefix', () => {
  const entries = parseSpaList(
    JSON.stringify({ data: [{ uuid: 'N1', title: 'اقتصادي / ارتفاع الصادرات', published_at: 1789166532, image: { path: 'https://cdn/x.jpg' } }, { uuid: '../x', title: 'bad' }] }),
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.title, 'ارتفاع الصادرات');
  assert.equal(entries[0]?.url, 'https://www.spa.gov.sa/ar/N1');
  assert.equal(entries[0]?.detailUrl, 'https://portalapi.spa.gov.sa/api/v1/news/N1');
  assert.equal(entries[0]?.image, 'https://cdn/x.jpg');
});

test('reads page meta tags in any attribute order', () => {
  const meta = extractMeta(
    `<html><head><title>Fallback</title><meta content="الخبر &amp; العنوان" property="og:title"><meta name="description" content="وصف"/><meta property="og:image" content="https://x/y.png"><meta property="article:published_time" content="2026-09-10T08:00:00+03:00"><meta property="og:site_name" content="العربية"></head></html>`,
  );
  assert.equal(meta.title, 'الخبر & العنوان');
  assert.equal(meta.description, 'وصف');
  assert.equal(meta.image, 'https://x/y.png');
  assert.equal(meta.siteName, 'العربية');
  assert.equal(meta.publishedAt, '2026-09-10T05:00:00.000Z');
  assert.equal(extractMeta('<title>Only</title>').title, 'Only');
});

test('keyword classifier flags Saudi decisions, hides sports without money and off-topic items', () => {
  const decision = classifyByKeywords({ id: '1', title: 'مجلس الوزراء يوافق على نظام الاستثمار الجديد', snippet: null, source: 'واس', tier: 'official', lang: 'ar', hint: null });
  assert.equal(decision.decision, true);
  assert.ok(decision.relevance >= 75);
  const sports = classifyByKeywords({ id: '2', title: 'الهلال يفوز في مباراة الدوري', snippet: null, source: 'عكاظ', tier: 'saudi', lang: 'ar', hint: null });
  assert.deepEqual(sports.topics, ['sports']);
  assert.equal(sports.businessAngle, false);
  const sportsMoney = classifyByKeywords({ id: '3', title: 'صفقة انتقال لاعب بقيمة 200 مليون ريال', snippet: null, source: 'عكاظ', tier: 'saudi', lang: 'ar', hint: null });
  assert.equal(sportsMoney.businessAngle, true);
  const weather = classifyByKeywords({ id: '4', title: 'أمطار على منطقة المدينة المنورة', snippet: null, source: 'واس', tier: 'official', lang: 'ar', hint: null });
  assert.equal(weather.decision, false);
  assert.ok(weather.relevance < 30);
  const foreign = classifyByKeywords({ id: '5', title: 'الإمارات تقر نظام ضريبة جديد', snippet: null, source: 'العربية', tier: 'saudi', lang: 'ar', hint: null });
  assert.equal(foreign.decision, false);
});

test('finds the same story across outlets', () => {
  const a = titleTokens('السعودية توقف احترازياً خط أنابيب شرق-غرب النفطي');
  const b = titleTokens('السعودية توقف خط أنابيب شرق غرب النفطي احترازيا');
  assert.ok(similarity(a, b) >= 0.6);
  const item = (overrides: Partial<NewsItem>): NewsItem => ({
    id: 'x', sourceId: 's', sourceName: 'n', tier: 'saudi', lang: 'ar', title: 't', snippet: null, url: 'u', image: null,
    publishedAt: '2026-09-12T00:00:00.000Z', verifiedAt: '2026-09-12T00:00:00.000Z', classifiedBy: 'keywords',
    topics: [], decision: false, businessAngle: true, relevance: 50, hidden: false, duplicateOf: null, ...overrides,
  });
  const existing = item({ id: 'a', title: 'السعودية توقف احترازياً خط أنابيب شرق-غرب النفطي' });
  const candidate = item({ id: 'b', title: 'السعودية توقف خط أنابيب شرق غرب النفطي احترازيا', publishedAt: '2026-09-12T05:00:00.000Z' });
  assert.equal(findDuplicate(candidate, titleTokens(candidate.title), [{ item: existing, tokens: titleTokens(existing.title) }])?.id, 'a');
  const old = item({ id: 'c', title: existing.title, publishedAt: '2026-09-01T00:00:00.000Z' });
  assert.equal(findDuplicate(candidate, titleTokens(candidate.title), [{ item: old, tokens: titleTokens(old.title) }]), null);
});

// ---- End to end: two fake feeds, fake pages, keyword classifier, routes.

const FEED_A = `<rss version="2.0"><channel>
<item><title>مجلس الوزراء يوافق على نظام الاستثمار الجديد</title><link>https://news.test/decision</link><description>وافق المجلس</description><pubDate>${new Date(Date.now() - 3_600_000).toUTCString()}</pubDate></item>
<item><title>الهلال يفوز في مباراة الدوري</title><link>https://news.test/sports</link><description>x</description><pubDate>${new Date().toUTCString()}</pubDate></item>
<item><title>شركة ناشئة سعودية تغلق جولة تمويل بقيمة 50 مليون ريال</title><link>https://news.test/startup</link><description>تمويل</description><pubDate>${new Date().toUTCString()}</pubDate></item>
<item><title>خبر لا يمكن فتحه</title><link>https://news.test/missing</link><pubDate>${new Date().toUTCString()}</pubDate></item>
</channel></rss>`;
const FEED_B = `<rss version="2.0"><channel>
<item><title>أرامكو تعلن نتائج الربع الثالث وارتفاع الأرباح</title><link>https://other.test/aramco</link><description>الطاقة</description><pubDate>${new Date().toUTCString()}</pubDate></item>
</channel></rss>`;

const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  const html = (title: string) => `<html><head><meta property="og:title" content="${title}"><meta property="og:description" content="وصف الصفحة"></head></html>`;
  if (url === 'https://feed.test/a') return new Response(FEED_A, { headers: { 'content-type': 'application/rss+xml' } });
  if (url === 'https://feed.test/b') return new Response(FEED_B, { headers: { 'content-type': 'application/rss+xml' } });
  if (url === 'https://feed.test/broken') return new Response('nope', { status: 500 });
  if (url === 'https://news.test/missing') return new Response('gone', { status: 404 });
  if (url.startsWith('https://news.test/') || url.startsWith('https://other.test/')) return new Response(html('t'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  throw new Error(`unexpected fetch ${url}`);
};

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', NEWS_REFRESH_MINUTES: '0' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let news: Awaited<ReturnType<typeof buildApp>>['news'];

before(async () => {
  await kv.set(NEWS_SOURCES_KEY, {
    sources: [
      { id: 'a', name: 'مصدر أ', url: 'https://feed.test/a', tier: 'official', lang: 'ar', enabled: true, hint: null },
      { id: 'b', name: 'مصدر ب', url: 'https://feed.test/b', tier: 'saudi', lang: 'ar', enabled: true, hint: null },
      { id: 'broken', name: 'معطل', url: 'https://feed.test/broken', tier: 'global', lang: 'ar', enabled: true, hint: null },
      { id: 'off', name: 'مغلق', url: 'https://feed.test/off', tier: 'global', lang: 'ar', enabled: false, hint: null },
    ],
    updatedAt: '2026-09-12T00:00:00.000Z',
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

test('refresh keeps only verified, on-topic items and reports source failures', async () => {
  const status = news.status();
  assert.equal(status.classifier, 'keywords');
  assert.equal(status.count, 4, 'missing page is never stored');
  assert.equal(status.visible, 3, 'sports without money is hidden');
  assert.equal(status.decisions, 1);
  assert.equal(status.sources.find((source) => source.id === 'broken')?.ok, false);
  assert.equal(status.sources.find((source) => source.id === 'off'), undefined);
  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.json().news.visible, 3);
});

test('serves the fixed decisions section and the general feed to guests', async () => {
  const decisions = await app.inject({ method: 'GET', url: '/api/news/decisions' });
  assert.equal(decisions.statusCode, 200);
  assert.equal(decisions.headers['cache-control'], 'no-store');
  assert.equal(decisions.json().items.length, 1);
  assert.equal(decisions.json().items[0].source.name, 'مصدر أ');
  assert.equal(decisions.json().items[0].source.tierLabel, 'مصدر رسمي');

  const feed = await app.inject({ method: 'GET', url: '/api/news/feed' });
  assert.equal(feed.json().total, 3);
  assert.equal(feed.json().personalized, false);
  assert.ok(feed.json().items.every((item: { url: string }) => !item.url.includes('/sports')));
  const decisionItem = feed.json().items.find((item: { url: string }) => item.url.endsWith('/decision'));
  assert.equal(decisionItem.snippet, 'وافق المجلس', 'the feed snippet is the source text');

  const topic = await app.inject({ method: 'GET', url: '/api/news/feed?topic=startups' });
  assert.deepEqual(topic.json().items.map((item: { url: string }) => item.url), ['https://news.test/startup']);
  assert.equal((await app.inject({ method: 'GET', url: '/api/news/feed?topic=nope' })).statusCode, 400);
});

test('returns one item and rejects unknown ids', async () => {
  const id = newsIdOf('https://news.test/startup');
  const res = await app.inject({ method: 'GET', url: `/api/news/${id}` });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().item.topics.some((topic: { key: string }) => topic.key === 'startups'));
  assert.equal((await app.inject({ method: 'GET', url: '/api/news/0000000000000000' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/news/not-an-id' })).statusCode, 400);
});

test('interests need a session, personalize the feed and reach the advisor context', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/news/prefs' })).statusCode, 401);
  const register = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'مختبر', country: 'sa', phone: '0558318777', email: 'tester@gmail.com', password: 'secret1', persona: 'investor', bio: 'أختبر التطبيق هنا' },
  });
  const verify = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: register.json().pendingToken, code: '123456' } });
  const token = verify.json().token as string;
  const headers = { authorization: `Bearer ${token}` };

  const empty = await app.inject({ method: 'GET', url: '/api/news/prefs', headers });
  assert.deepEqual(empty.json().topics, []);
  assert.ok(empty.json().suggested.includes('markets'), 'investor defaults');
  assert.equal(empty.json().saved, false);

  const personaFeed = await app.inject({ method: 'GET', url: '/api/news/feed', headers });
  assert.equal(personaFeed.json().personalized, true);

  const saved = await app.inject({ method: 'PUT', url: '/api/news/prefs', headers, payload: { topics: ['startups', 'bogus', 'startups'] } });
  assert.deepEqual(saved.json().topics, ['startups']);
  const feed = await app.inject({ method: 'GET', url: '/api/news/feed', headers });
  assert.equal(feed.json().items[0].url, 'https://news.test/startup', 'interest match ranks first');

  const id = newsIdOf('https://news.test/startup');
  const message = await app.inject({ method: 'POST', url: '/api/advisor/message', headers, payload: { text: 'ما رأيك؟', context: { type: 'news', id } } });
  assert.equal(message.statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/advisor/message', headers, payload: { text: 'x', context: { type: 'news', id: 'bad' } } })).statusCode, 400);
});
