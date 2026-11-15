import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import Fastify from 'fastify';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { EnglishCache } from '../englishCache.js';
import { MockHubClient } from '../hub/mock.js';
import { MemoryKV } from '../store.js';
import type { Translator } from '../translate.js';
import { parseOfferPage, type OfferBlock } from './parse.js';
import { GoldenOffersService, OFFERS_KEY, sameFigures } from './service.js';

/** Golden offer pages in-app (PROJECT_BRIEF §5.1): the parser, the refresh and the public routes. */

const OFFER_HTML = `<!doctype html><html dir="rtl" lang="ar"><head><title>فرصة للشراكة</title>
<style>.x{color:red}</style></head><body>
<div data-elementor-type="header"><ul><li><a href="/">الرئيسية</a></li><li><a href="/about">من نحن</a></li></ul></div>
<div data-elementor-type="wp-page">
<script>var tracked = true;</script>
<section><h1>شكرًا لاهتمامك بفرصة الشراكة</h1>
<p>هذه الصفحة تقدّم ملخصًا موجزًا لوثيقة الشراكة.</p>
<img width="24" height="24" src="https://example.com/icon.png">
<img src="data:image/gif;base64,R0lGOD">
<img data-lazy-src="https://example.com/uploads/hero.webp" src="data:image/svg+xml;x">
</section>
<section><h2>منظومة واحدة تجمع الخدمات</h2>
<ul><li>تكامل مع تطبيق سكة</li><li>ترخيص كامل <span>للمنظومة</span></li></ul>
<blockquote>رأي أحد الشركاء في التجربة</blockquote>
<a class="elementor-button" href="#contactus">سجل طلب شراكة</a>
<form><input name="email"><p>نص داخل النموذج لا يظهر</p></form>
</section>
<section class="elementor-hidden-desktop"><h2>منظومة واحدة تجمع الخدمات</h2></section>
<img src="/uploads/relative.jpg">
</div>
<div data-elementor-type="footer"><p>جميع الحقوق محفوظة</p><ul><li>سياسة الخصوصية</li></ul></div>
</body></html>`;

test('parseOfferPage keeps the page content in order and drops the chrome', () => {
  const blocks = parseOfferPage(OFFER_HTML, 'https://wdeny.com/offer/');
  const texts = blocks.map((block) => (block.type === 'image' ? `img:${block.url}` : `${block.type}:${block.text}`));
  assert.deepEqual(texts, [
    'heading:شكرًا لاهتمامك بفرصة الشراكة',
    'text:هذه الصفحة تقدّم ملخصًا موجزًا لوثيقة الشراكة.',
    'img:https://example.com/uploads/hero.webp',
    'heading:منظومة واحدة تجمع الخدمات',
    'bullet:تكامل مع تطبيق سكة',
    'bullet:ترخيص كامل للمنظومة',
    'text:رأي أحد الشركاء في التجربة',
    'img:https://wdeny.com/uploads/relative.jpg',
  ]);
  const h1 = blocks[0];
  assert.ok(h1 && h1.type === 'heading' && h1.level === 1);
});

test('M121b: the old Arabic brand name on a web page always reads «Vibes Ventures» in the app', () => {
  const html = `<html><body><main data-elementor-type="wp-page">
    <h1>شكرًا لاهتمامك بـ«فايبز القابضة للاستثمار»</h1>
    <p>علامات تجارية مسجّلة تعمل فعليًا تحت مظلة فايبز القابضة.</p>
    <p>تنفرد «ڤايبز» كشريك ملكية داخل بيئة «فايبز» نفسها، بدعم فيبس فينشرز.</p>
  </main></body></html>`;
  const texts = parseOfferPage(html, 'https://vibesholding.com/offer/').map((block) => (block.type === 'image' ? '' : block.text));
  assert.deepEqual(texts, [
    'شكرًا لاهتمامك بـ«Vibes Ventures»',
    'علامات تجارية مسجّلة تعمل فعليًا تحت مظلة Vibes Ventures.',
    'تنفرد «Vibes Ventures» كشريك ملكية داخل بيئة «Vibes Ventures» نفسها، بدعم Vibes Ventures.',
  ]);
});

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', NEWS_REFRESH_MINUTES: '0', GOLDEN_REFRESH_MINUTES: '0' });
let built: Awaited<ReturnType<typeof buildApp>>;

const fetchImpl: typeof fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://wdeny.com/offer/') return new Response(OFFER_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response('<html><body><p>down</p></body></html>', { status: 503 });
};

before(async () => {
  built = await buildApp({ config, kv, hub: new MockHubClient(), fetchImpl });
  await built.golden.refresh();
});

after(async () => {
  await built.app.close();
});

test('the offer route answers parsed blocks for a fetched company and stays up for the rest', async () => {
  const fetched = await built.app.inject({ method: 'GET', url: '/api/golden/offer/01' });
  assert.equal(fetched.statusCode, 200);
  const offer = fetched.json();
  assert.equal(offer.company.code, '01');
  assert.equal(offer.company.name, 'وديني');
  assert.ok(offer.blocks.length >= 5);
  assert.ok(offer.fetchedAt);
  assert.ok(offer.disclaimer.includes('ضمانًا'));

  // A company whose site failed: the page still answers, with the pending state (no blocks yet).
  const pending = await built.app.inject({ method: 'GET', url: '/api/golden/offer/04' });
  assert.equal(pending.statusCode, 200);
  assert.deepEqual(pending.json().blocks, []);
  assert.equal(pending.json().fetchedAt, null);

  const unknown = await built.app.inject({ method: 'GET', url: '/api/golden/offer/99' });
  assert.equal(unknown.statusCode, 404);
  assert.ok(built.golden.status().lastError?.includes('04'));
});

// M242 (complaint «عربي في وضع الإنجليزية»): the offer pages reached the English app in Arabic.
const FIGURES_HTML = `<html><body><main data-elementor-type="wp-page">
<h1>فرصة الشراكة في شركة وديني</h1>
<p>تقييم الشركة 12 مليون ريال، والحصة المطروحة 15% من رأس المال.</p>
<ul><li>أكثر من 1,500 رحلة شهريًا</li><li>ترخيص كامل للمنظومة</li></ul>
<img src="https://example.com/uploads/hero.webp">
</main></body></html>`;

test('the offer pages get an English copy; a block whose figures change stays Arabic; Arabic is untouched', async () => {
  const offerKv = new MemoryKV();
  const batches: string[][] = [];
  const lines: Record<string, string> = {
    'فرصة الشراكة في شركة وديني': 'The partnership opportunity in Wdeny',
    // The translator moved a figure (15% became 51%): this block must stay Arabic.
    'تقييم الشركة 12 مليون ريال، والحصة المطروحة 15% من رأس المال.': 'The company is valued at SAR 12 million, and the share on offer is 51% of the capital.',
    'أكثر من 1,500 رحلة شهريًا': 'More than 1,500 trips a month',
    'ترخيص كامل للمنظومة': 'A full licence for the whole system',
  };
  const translator: Translator = {
    mode: 'openai',
    translate: async (texts) => {
      batches.push(texts);
      return texts.map((text) => lines[text] ?? '');
    },
  };
  const pages: typeof fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    return url === 'https://wdeny.com/offer/' ? new Response(FIGURES_HTML, { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('down', { status: 503 });
  };
  let moved = 0;
  const service = new GoldenOffersService({ kv: offerKv, config, log: Fastify({ logger: false }).log, fetchImpl: pages, onChange: () => (moved += 1), english: new EnglishCache(offerKv, translator, 'golden') });
  await service.refresh();
  // The refresh does not wait for the English pass (the dashboard's «تحديث الآن» waits for the refresh).
  await service.englishIdle();

  const offer = service.get('01');
  assert.ok(offer?.blocksEn);
  const shown = (blocks: OfferBlock[]) => blocks.map((block) => (block.type === 'image' ? `img:${block.url}` : block.text));
  assert.deepEqual(shown(offer.blocksEn), [
    'The partnership opportunity in Wdeny',
    'تقييم الشركة 12 مليون ريال، والحصة المطروحة 15% من رأس المال.',
    'More than 1,500 trips a month',
    'A full licence for the whole system',
    'img:https://example.com/uploads/hero.webp',
  ]);
  assert.equal(offer.blocksEn[0]?.type, 'heading', 'a block keeps its kind and its place');
  assert.match(shown(offer.blocks)[0] ?? '', /فرصة الشراكة/, 'the Arabic page is what it was');
  assert.equal(moved, 1, 'the English copy tells open apps once');
  assert.equal(batches.length, 1);

  // An unchanged page is not translated again (each text is cached; the figure that failed is asked for no model call either).
  await service.refresh();
  await service.englishIdle();
  assert.equal(batches.length, 1);
  assert.equal(moved, 1);

  // The copy survives a restart.
  const restarted = new GoldenOffersService({ kv: offerKv, config, log: Fastify({ logger: false }).log, fetchImpl: pages });
  await restarted.start();
  assert.deepEqual(shown(restarted.get('01')?.blocksEn ?? []), shown(offer.blocksEn));

  // The rule on figures, on its own.
  assert.equal(sameFigures('الحصة 15% بقيمة 1,500 ريال', 'A 15% share worth SAR 1,500'), true);
  assert.equal(sameFigures('الحصة ١٥٪', 'A 15 percent share'), true, 'Arabic digits and the percent sign count as the same figure');
  assert.equal(sameFigures('الحصة 15%', 'A 51% share'), false);
  assert.equal(sameFigures('ثلاث شركات', 'Three companies'), true, 'words on both sides are not figures');
  assert.equal(sameFigures('3 شركات', 'Three companies'), false, 'a figure written out is not accepted: the block stays Arabic');
  // The digits alone are not the figure: the scale and the currency must be the same on both sides.
  assert.equal(sameFigures('10 مليون ريال', '10 billion dollars'), false);
  assert.equal(sameFigures('تقييم الشركة 10 مليون ريال', 'The company is valued at SAR 10 million'), true);
  assert.equal(sameFigures('تقييم الشركة 10 مليون ريال', 'The company is valued at 10 million riyals'), true);
  assert.equal(sameFigures('تقييم الشركة 10 مليون ريال', 'The company is valued at 10 million dollars'), false, 'another currency');
  assert.equal(sameFigures('تقييم الشركة 10 مليون ريال', 'The company is valued at SAR 10 billion'), false, 'another scale');
  assert.equal(sameFigures('3 ملايين دولار', 'USD 3 million'), true, 'a plural counts once');
  assert.equal(sameFigures('أكثر من 5 آلاف عميل', 'More than 5 thousand customers'), true);
  assert.equal(sameFigures('أكثر من 5 آلاف عميل', 'More than 5 million customers'), false);
  assert.equal(sameFigures('رسوم 250 ريال', 'A fee of 250'), false, 'a currency dropped in translation');
});

test('the refresh never waits for the English pass, one pass runs at a time, and an older page is never written back', async () => {
  const offerKv = new MemoryKV();
  let page = 'أول';
  const html = () => `<html><body><main data-elementor-type="wp-page"><h1>عرض الشراكة ${page}</h1><p>تفاصيل العرض ${page} كما نُشرت</p></main></body></html>`;
  const pages: typeof fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    return url === 'https://wdeny.com/offer/' ? new Response(html(), { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('down', { status: 503 });
  };
  // A translator that holds every call until the test lets it go.
  const waiting: (() => void)[] = [];
  let running = 0;
  let mostAtOnce = 0;
  const translator: Translator = {
    mode: 'openai',
    translate: async (texts) => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      await new Promise<void>((resolve) => waiting.push(resolve));
      running -= 1;
      return texts.map((text) => (text.includes('ثانٍ') ? 'Second page' : 'First page'));
    },
  };
  const service = new GoldenOffersService({ kv: offerKv, config, log: Fastify({ logger: false }).log, fetchImpl: pages, english: new EnglishCache(offerKv, translator, 'golden') });
  const shown = (blocks: OfferBlock[] | undefined) => (blocks ?? []).map((block) => (block.type === 'image' ? '' : block.text));
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

  // The refresh comes back while the translator has not answered anything yet.
  await service.refresh();
  assert.match(shown(service.get('01')?.blocks)[0] ?? '', /أول/);
  assert.equal(service.get('01')?.blocksEn, undefined, 'the Arabic page answers; its English is still on the way');
  await tick();
  assert.equal(waiting.length, 1);

  // The site changes and a second refresh lands while the first pass is still waiting.
  page = 'ثانٍ';
  await service.refresh();
  await tick();
  assert.equal(waiting.length, 1, 'no second pass starts beside the first');

  // The first pass ends with the English of the OLD page: it is not written over the new one.
  waiting.shift()?.();
  await tick();
  assert.match(shown(service.get('01')?.blocks)[0] ?? '', /ثانٍ/, 'the newer Arabic page stands');
  assert.ok(!shown(service.get('01')?.blocksEn).includes('First page'));
  // The pass that follows the second refresh translates the new page.
  assert.equal(waiting.length, 1);
  waiting.shift()?.();
  await service.englishIdle();
  assert.deepEqual(shown(service.get('01')?.blocksEn), ['Second page', 'Second page']);
  assert.match(shown(service.get('01')?.blocks)[0] ?? '', /ثانٍ/);
  assert.equal(mostAtOnce, 1);
});

test('a long page goes to the translator in batches of 40, and one failed batch does not lose the others', async () => {
  const seen: number[] = [];
  let call = 0;
  const translator: Translator = {
    mode: 'openai',
    translate: async (texts) => {
      seen.push(texts.length);
      call += 1;
      return call === 2 ? null : texts.map((_, index) => `Line ${call}-${index}`);
    },
  };
  const cache = new EnglishCache(new MemoryKV(), translator, 'golden');
  const list = Array.from({ length: 95 }, (_, index) => `سطر عربي رقم ${index}`);
  const english = await cache.texts(list, 'en');
  assert.deepEqual(seen, [40, 40, 15]);
  assert.equal(english[0], 'Line 1-0');
  assert.equal(english[40], list[40], 'the failed batch stays as stored');
  assert.equal(english[80], 'Line 3-0');
});

test('the offer route answers the English copy to the English app only', async () => {
  const stored = (await kv.get<{ offers: Record<string, { blocks: OfferBlock[]; blocksEn?: OfferBlock[] }>; updatedAt: string | null }>(OFFERS_KEY)) ?? { offers: {}, updatedAt: null };
  const page = stored.offers['01'];
  assert.ok(page);
  // No translator in this app (no OpenAI key): the English app still gets the page, in Arabic, never an empty one.
  const before = await built.app.inject({ method: 'GET', url: '/api/golden/offer/01', headers: { 'x-app-lang': 'en' } });
  assert.deepEqual(before.json().blocks, page.blocks);
  // Once the copy exists it is what the English app reads; the Arabic app keeps the page as written.
  page.blocksEn = page.blocks.map((block) => (block.type === 'image' ? block : { ...block, text: 'An English line' }));
  await kv.set(OFFERS_KEY, stored);
  await built.golden.start();
  const english = await built.app.inject({ method: 'GET', url: '/api/golden/offer/01', headers: { 'x-app-lang': 'en' } });
  assert.ok((english.json().blocks as OfferBlock[]).every((block) => block.type === 'image' || block.text === 'An English line'));
  assert.equal(english.headers['cache-control'], 'no-store');
  const arabic = await built.app.inject({ method: 'GET', url: '/api/golden/offer/01' });
  assert.deepEqual(arabic.json().blocks, page.blocks);
});

test('a guest registers interest with a phone number; without one he is asked for it', async () => {
  const refused = await built.app.inject({ method: 'POST', url: '/api/golden/offer/01/interest', payload: { name: 'زائر' } });
  assert.equal(refused.statusCode, 400);
  const accepted = await built.app.inject({
    method: 'POST',
    url: '/api/golden/offer/01/interest',
    payload: { name: 'زائر مهتم', phone: '0551234567', note: 'أرغب بمعرفة التفاصيل' },
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().ok, true);
  const unknown = await built.app.inject({ method: 'POST', url: '/api/golden/offer/99/interest', payload: { phone: '0551234567' } });
  assert.equal(unknown.statusCode, 404);
});
