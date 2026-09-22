import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { STUDIO_WHATSAPP } from './content/services.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { MemoryKV } from './store.js';
import { TemplateBlurbWriter } from './videos/blurbs.js';

const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });
const kv = new MemoryKV();
let built: BuiltApp;
let app: BuiltApp['app'];

const CHANNEL_HTML = '<html><head><meta property="og:title" content="نادي المستثمرين"><link rel="canonical" href="https://www.youtube.com/channel/UCAbCdEfGhIjKlMnOpQrStUv"></head></html>';
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>نادي المستثمرين</title>
  <entry><yt:videoId>CnWMWS_nDpM</yt:videoId><title>قصة نادي المستثمرين</title><published>2026-08-01T10:00:00+00:00</published>
    <media:group><media:description>كيف بدأ النادي وكيف وصل إلى آلاف الأعضاء خلال سنوات قليلة.</media:description></media:group></entry>
  <entry><yt:videoId>a1b2c3d4e5F</yt:videoId><title>ملتقى سبتمبر</title><published>2026-09-01T10:00:00+00:00</published></entry>
</feed>`;

const fetchStub: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes('/@investorscl')) return new Response(CHANNEL_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
  if (url.includes('feeds/videos.xml')) return new Response(FEED, { status: 200, headers: { 'content-type': 'application/atom+xml' } });
  throw new Error(`unexpected fetch ${url}`);
};

const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const post = (url: string, payload: Record<string, unknown>, token?: string) =>
  app.inject({ method: 'POST', url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function signUp(email: string, phone: string): Promise<string> {
  const registered = await post('/api/auth/register', {
    name: 'عضو تجريبي',
    country: 'sa',
    phone,
    email,
    password: 'secret123',
    persona: 'investor',
    bio: 'مستثمر مهتم بفرص الشراكة في قطاع التقنية.',
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return verified.json().token as string;
}

let memberToken = '';
let unactivatedToken = '';

before(async () => {
  built = await buildApp({ config, kv, hub: new MockHubClient(), blurbs: new TemplateBlurbWriter(), fetchImpl: fetchStub });
  app = built.app;
  memberToken = await signUp('salem+member@gmail.com', '0558318777');
  unactivatedToken = await signUp('guest.test@gmail.com', '0558318778');
});

after(async () => {
  await app.close();
});

test('home, about and membership content follow the wording rules', async () => {
  const home = await get('/api/home');
  assert.equal(home.statusCode, 200);
  assert.deepEqual(
    home.json().portals.map((portal: { key: string }) => portal.key),
    ['neutral', 'entrepreneur', 'investor'],
  );
  assert.equal(home.json().neutralOpening.quickReplies.length, 4);

  const about = await get('/api/about');
  assert.equal(about.statusCode, 200);
  assert.ok(about.json().sections.length >= 4);
  assert.equal(about.json().legal.cr, '2050179051');

  const membership = await get('/api/membership');
  assert.equal(membership.statusCode, 200);
  assert.equal(membership.json().title, 'العضوية السنوية لنادي المستثمرين');
  assert.equal(membership.json().groups.length, 6);
  // Older app versions still get the flat lists.
  assert.equal(membership.json().benefits.length, 23);
  // Rule 3: the web price block of the owner's page and its pay links never reach the app.
  assert.ok(!/1,900|3,900|160 ريال|paymob|اشترك الآن/.test(membership.body));
  assert.equal(membership.json().comingSoon.length, 4);

  const hq = await get('/api/hq');
  const services = await get('/api/services');
  for (const raw of [home.body, about.body, membership.body, hq.body, services.body]) {
    // ISO dates and datetimes are data, not prose.
    const body = raw.replace(/\d{4}-\d{2}-\d{2}(T[^"]*)?/g, '');
    assert.ok(!/مجان/.test(body), 'never «مجاني»');
    assert.ok(!/كريديت/.test(body), 'never «كريديت»');
    assert.ok(!/\d-\d/.test(body), 'no hyphen between two numbers');
  }
  assert.equal(home.headers['cache-control'], 'no-store');
});

test('services are listed for everyone but member-only ones are locked without an active membership', async () => {
  const guest = await get('/api/services');
  assert.equal(guest.statusCode, 200);
  const list = guest.json();
  assert.equal(list.services.length, 15);
  assert.equal(list.groups.length, 3);
  assert.equal(list.isMember, false);
  const studio = list.services.find((service: { key: string }) => service.key === 'studio');
  assert.equal(studio.locked, true);
  assert.equal(studio.action, null);
  const pitch = list.services.find((service: { key: string }) => service.key === 'pitch-deck');
  assert.equal(pitch.locked, false);
  assert.equal(pitch.action.type, 'paymob');
  assert.equal(pitch.action.fields.length, 2);

  const guestStudio = await get('/api/services/studio');
  assert.equal(guestStudio.json().service.locked, true);
  assert.match(guestStudio.json().lockedText, /سجّل الدخول/);

  const unactivated = await get('/api/services/studio', unactivatedToken);
  assert.equal(unactivated.json().service.locked, true);
  assert.doesNotMatch(unactivated.json().lockedText, /سجّل الدخول/);

  const member = await get('/api/services/studio', memberToken);
  assert.equal(member.json().service.locked, false);
  assert.equal(member.json().service.action.phone, STUDIO_WHATSAPP);
  assert.equal(member.json().isMember, true);

  const missing = await get('/api/services/nope');
  assert.equal(missing.statusCode, 404);
});

test('advisor accepts portal and service contexts', async () => {
  const portal = await post('/api/advisor/message', { text: 'أريد التعرّف على المنظومة', context: { type: 'portal', id: 'neutral' } }, memberToken);
  assert.equal(portal.statusCode, 200, portal.body);
  const service = await post('/api/advisor/message', { text: 'ما باقات الاستديو؟', context: { type: 'service', id: 'studio' } }, memberToken);
  assert.equal(service.statusCode, 200, service.body);
  const bad = await post('/api/advisor/message', { text: 'x', context: { type: 'portal', id: 'nope' } }, memberToken);
  assert.equal(bad.statusCode, 400);
});

test('HQ: member books → admin confirms → QR pass → verify; others are refused', async () => {
  const guest = await get('/api/hq');
  assert.equal(guest.statusCode, 200);
  assert.equal(guest.json().access, 'guest');
  assert.ok(guest.json().days.length > 10);
  assert.equal(guest.json().content.slotCapacity, undefined);
  assert.match(guest.json().lockedText, /سجّل الدخول/);

  const member = await get('/api/hq', memberToken);
  assert.equal(member.json().access, 'member');
  assert.equal(member.json().lockedText, null);
  const date = member.json().days[0].date as string;
  const time = member.json().times[0] as string;

  const slots = await get(`/api/hq/slots?date=${date}`, memberToken);
  assert.equal(slots.statusCode, 200, slots.body);
  assert.ok(slots.json().slots.every((slot: { available: boolean }) => slot.available));
  const badDate = await get('/api/hq/slots?date=2020-01-01', memberToken);
  assert.equal(badDate.statusCode, 400);

  const locked = await post('/api/hq/visits', { date, time, purpose: 'اجتماع عمل', note: '' }, unactivatedToken);
  assert.equal(locked.statusCode, 403);
  assert.equal(locked.json().error.code, 'members_only');
  const noSession = await post('/api/hq/visits', { date, time, purpose: 'اجتماع عمل', note: '' });
  assert.equal(noSession.statusCode, 401);

  const badPurpose = await post('/api/hq/visits', { date, time, purpose: 'شيء آخر', note: '' }, memberToken);
  assert.equal(badPurpose.statusCode, 400);
  assert.equal(badPurpose.json().error.code, 'bad_purpose');

  const booked = await post('/api/hq/visits', { date, time, purpose: 'اجتماع عمل', note: 'لقاء مع فريق النادي' }, memberToken);
  assert.equal(booked.statusCode, 200, booked.body);
  const visit = booked.json().visit;
  assert.equal(visit.status, 'pending');
  assert.equal(visit.hasPass, false);
  assert.equal(visit.cancellable, true);

  const duplicate = await post('/api/hq/visits', { date, time: member.json().times[1], purpose: 'أخرى', note: '' }, memberToken);
  assert.equal(duplicate.statusCode, 400);
  assert.equal(duplicate.json().error.code, 'duplicate');

  const mine = await get('/api/hq/visits', memberToken);
  assert.equal(mine.json().visits.length, 1);
  const early = await get(`/api/hq/visits/${visit.id}/pass`, memberToken);
  assert.equal(early.statusCode, 400);
  assert.equal(early.json().error.code, 'not_confirmed');
  const notMine = await get(`/api/hq/visits/${visit.id}/pass`, unactivatedToken);
  assert.equal(notMine.statusCode, 404);

  // Every verified mock account is a hub admin in the test environment.
  const pending = await get('/api/admin/hq/visits?status=pending', memberToken);
  assert.equal(pending.statusCode, 200, pending.body);
  assert.equal(pending.json().visits.length, 1);
  assert.equal(pending.json().visits[0].name, 'عضو تجريبي');
  assert.ok(pending.json().visits[0].phone);

  const confirmed = await post(`/api/admin/hq/visits/${visit.id}/decision`, { status: 'confirmed', note: 'أهلًا بك' }, memberToken);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().visit.status, 'confirmed');
  assert.equal(confirmed.json().visit.hasPass, true);
  const again = await post(`/api/admin/hq/visits/${visit.id}/decision`, { status: 'rejected', note: '' }, memberToken);
  assert.equal(again.statusCode, 400);

  const pass = await get(`/api/hq/visits/${visit.id}/pass`, memberToken);
  assert.equal(pass.statusCode, 200, pass.body);
  assert.match(pass.json().pass.qr, /^data:image\/png;base64,/);
  assert.match(pass.json().pass.code, /^VCHQ:/);
  assert.equal(pass.json().pass.state, 'upcoming');
  assert.equal(pass.json().pass.visit.adminNote, 'أهلًا بك');

  const verified = await post('/api/admin/hq/verify', { code: pass.json().pass.code }, memberToken);
  assert.equal(verified.statusCode, 200, verified.body);
  assert.equal(verified.json().state, 'upcoming');
  assert.equal(verified.json().valid, false);
  assert.equal(verified.json().visit.name, 'عضو تجريبي');
  const unknown = await post('/api/admin/hq/verify', { code: 'VCHQ:x:nope' }, memberToken);
  assert.equal(unknown.json().state, 'unknown');

  const cancelled = await post(`/api/hq/visits/${visit.id}/cancel`, {}, memberToken);
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(cancelled.json().visit.status, 'cancelled');
  const slotsAfter = await get(`/api/hq/slots?date=${date}`, memberToken);
  assert.equal(slotsAfter.json().slots[0].available, true);
});

test('videos: the channel feed fills the library, curated picks come first, blurbs are written once', async () => {
  await built.videos.refresh();
  const status = built.videos.status();
  assert.equal(status.mode, 'rss');
  assert.equal(status.count, 2);
  assert.equal(status.channelId, 'UCAbCdEfGhIjKlMnOpQrStUv');

  const list = await get('/api/videos?limit=1');
  assert.equal(list.statusCode, 200, list.body);
  const page = list.json();
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.hasMore, true);
  assert.equal(page.items[0].id, 'a1b2c3d4e5F');
  assert.equal(page.items[0].blurb, 'في هذا الفيديو من نادي المستثمرين: ملتقى سبتمبر');
  assert.equal(page.featured.length, 8);
  assert.equal(page.featured[0].id, 'CnWMWS_nDpM');
  assert.equal(page.featured[0].title, 'قصة نادي المستثمرين');
  assert.equal(page.featured[0].featuredLabel, 'قصة نادي المستثمرين');
  assert.match(page.featured[0].blurb, /^كيف بدأ النادي/);
  // A curated pick the feed has not listed yet still plays with its label as the title.
  const tour = page.featured.find((video: { id: string }) => video.id === 'XERenNWNziA');
  assert.equal(tour.title, 'جولة في مقر النادي');
  assert.equal(tour.publishedAt, null);
  assert.equal(tour.url, 'https://www.youtube.com/watch?v=XERenNWNziA');

  const one = await get('/api/videos/CnWMWS_nDpM');
  assert.equal(one.statusCode, 200);
  assert.equal(one.json().video.title, 'قصة نادي المستثمرين');
  assert.equal((await get('/api/videos/bad')).statusCode, 400);
  assert.equal((await get('/api/videos/AAAAAAAAAAA')).statusCode, 404);

  const health = await get('/health');
  assert.equal(health.json().videos.count, 2);
});
