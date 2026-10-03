import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MockHubClient } from '../hub/mock.js';
import { MemoryKV } from '../store.js';
import { parseOfferPage } from './parse.js';

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
