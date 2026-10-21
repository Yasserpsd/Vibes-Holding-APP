import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MOCK_CODE, MockHubClient } from '../hub/mock.js';
import { MemoryKV } from '../store.js';
import { CONTENT_BLOCKS } from './admin.js';
import { contentProblem } from './edits.js';
import { HQ_SEED } from './hq.js';
import { at, isArabic, localize, untranslated, wordingOf } from './i18n.js';

/** M27 stage 3: the server content in two languages, and the owner's edits of it from the dashboard. */

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', NEWS_REFRESH_MINUTES: '0' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let token = '';

before(async () => {
  app = (await buildApp({ config, kv, hub: new MockHubClient() })).app;
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'مدير المحتوى', country: 'sa', phone: '0558318712', email: 'content.admin@gmail.com', password: 'secret123', persona: 'neutral', bio: 'حساب لاختبار تعديل محتوى التطبيق.' } });
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  token = verified.json().token as string;
});

after(async () => {
  await app.close();
});

const get = (url: string, lang?: string) => app.inject({ method: 'GET', url, headers: lang ? { 'x-app-lang': lang } : {} });
const put = (payload: Record<string, unknown>, auth = token) => app.inject({ method: 'PUT', url: '/api/admin/content', payload, headers: auth ? { authorization: `Bearer ${auth}` } : {} });

test('wording paths name list items by their key and leave links, ids, numbers and times alone', () => {
  const paths = wordingOf(HQ_SEED).map((entry) => entry.path);
  assert.ok(paths.includes('title') && paths.includes('facilities.0') && paths.includes('rules.2') && paths.includes('purposes.4'));
  assert.ok(!paths.some((path) => /mapUrl|tourVideoId|hours|leadDays|slotCapacity|version|updatedAt/.test(path)));
  const services = CONTENT_BLOCKS.find((block) => block.key === 'services')!;
  const servicePaths = wordingOf(services.seed).map((entry) => entry.path);
  assert.ok(servicePaths.includes('services.meetup.title') && servicePaths.includes('services.pitch-deck.action.fields.stage.options.1') && servicePaths.includes('groups.member.title'));
  assert.ok(!servicePaths.some((path) => /phone|amount|infoUrl|icon|order|\.key$|\.url$/.test(path)), servicePaths.filter((path) => /phone|amount|infoUrl|icon|order|\.key$|\.url$/.test(path)).join(', '));
  assert.equal(at(services.seed, 'services.credit.memberLabel'), 'ضمن العضوية');
});

test('every English seed covers every Arabic text of its block, in English, within the copy rules', () => {
  for (const block of CONTENT_BLOCKS) {
    assert.deepEqual(untranslated(block.seed, block.translation), [], `${block.key}: untranslated paths`);
    for (const entry of wordingOf(block.seed)) {
      const english = at(block.translation, entry.path);
      assert.equal(typeof english, 'string', `${block.key}.${entry.path}`);
      assert.ok(!isArabic(english as string), `${block.key}.${entry.path} is still Arabic`);
      assert.equal(contentProblem('en', english as string), null, `${block.key}.${entry.path}: ${contentProblem('en', english as string)}`);
      assert.equal(contentProblem('ar', entry.value), null, `${block.key}.${entry.path}: ${contentProblem('ar', entry.value)}`);
    }
  }
});

test('localize keeps the structure, swaps the wording, and lets an edit win', () => {
  const english = localize(HQ_SEED, { title: 'Club HQ', facilities: ['15 equipped offices'] }, {});
  assert.deepEqual([english.title, english.facilities[0], english.facilities[1], english.hours, english.mapUrl], ['Club HQ', '15 equipped offices', HQ_SEED.facilities[1], HQ_SEED.hours, HQ_SEED.mapUrl]);
  const edited = localize(HQ_SEED, { title: 'Club HQ' }, { title: 'The HQ', 'rules.0': 'By booking only.', 'no.such.path': 'x' });
  assert.deepEqual([edited.title, edited.rules[0], edited.rules[1]], ['The HQ', 'By booking only.', HQ_SEED.rules[1]]);
  assert.equal(localize(HQ_SEED, null, {}).title, HQ_SEED.title);
});

test('the app reads every block in its language; the logic keeps the Arabic structure', async () => {
  const arabic = (await get('/api/home')).json();
  const english = (await get('/api/home', 'en')).json();
  assert.equal(arabic.hero.title, 'مجتمع راقٍ يؤمن بأن الفكر ثروة');
  assert.equal(english.hero.title, 'A refined community that believes ideas are wealth');
  assert.deepEqual(english.portals.map((portal: { key: string; title: string }) => [portal.key, portal.title]), [['neutral', 'Neutral'], ['entrepreneur', 'Entrepreneur'], ['investor', 'Investor']]);
  assert.equal((await get('/api/home?lang=en')).json().hero.title, english.hero.title, '?lang= wins for the dashboard');

  const services = (await get('/api/services', 'en')).json();
  const meetup = services.services.find((service: { key: string }) => service.key === 'meetup');
  assert.deepEqual([meetup.title, meetup.priceLabel, meetup.action.fields[0].label, meetup.action.phone ?? meetup.action.amount], ['Make your meetup', 'SAR 30,000', 'Meetup topic', 30000]);
  assert.equal(services.lockedText, 'This feature is exclusive to Investors Club members. Join now to enjoy all membership benefits.');
  assert.equal((await get('/api/services/credit', 'en')).json().service.title, 'Projects Bank balance');

  assert.equal((await get('/api/membership', 'en')).json().groups[0].title, 'Why it is worth it even before you set your direction');
  assert.equal((await get('/api/golden', 'en')).json().companies[0].name, 'Wdeny');
  assert.equal((await get('/api/about', 'en')).json().sections[1].bullets[0], 'Success Partners: a venture starts by registering, and a specialised committee reviews it before it is approved.');
  const hq = (await get('/api/hq', 'en')).json();
  assert.deepEqual([hq.content.title, hq.content.hours.open, hq.lockedText], ['Club HQ', HQ_SEED.hours.open, 'This feature is exclusive to Investors Club members. Join now to enjoy all membership benefits.']);
  assert.equal((await get('/api/videos', 'en')).json().title, 'Get to know us');
  assert.equal((await get('/api/videos')).json().title, 'تعرف علينا');
});

test('only a dashboard admin edits a text; each language keeps its own edits; the app hears of it', async () => {
  assert.equal((await put({ block: 'hq', path: 'title', lang: 'ar', value: 'المقر' }, '')).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/content' })).statusCode, 401);

  const syncBefore = (await get('/api/sync')).json().v.content as number;
  const saved = await put({ block: 'hq', path: 'title', lang: 'ar', value: '  مقر النادي بالرياض ' });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual([saved.json().edit.value, saved.json().edit.by], ['مقر النادي بالرياض', 'مدير المحتوى']);
  assert.notEqual((await get('/api/sync')).json().v.content, syncBefore, 'open apps hear of the edit');
  assert.equal((await get('/api/hq')).json().content.title, 'مقر النادي بالرياض');
  assert.equal((await get('/api/hq', 'en')).json().content.title, 'Club HQ', 'the English version keeps its own text');

  assert.equal((await put({ block: 'hq', path: 'title', lang: 'en', value: 'The Club HQ' })).statusCode, 200);
  assert.equal((await get('/api/hq', 'en')).json().content.title, 'The Club HQ');

  assert.match((await put({ block: 'hq', path: 'title', lang: 'ar', value: 'دخول مجاني' })).json().error.message, /بدون رسوم/);
  assert.match((await put({ block: 'hq', path: 'title', lang: 'en', value: 'Free entry' })).json().error.message, /free/);
  assert.match((await put({ block: 'hq', path: 'title', lang: 'ar', value: '   ' })).json().error.message, /فارغ/);
  assert.match((await put({ block: 'hq', path: 'mapUrl', lang: 'ar', value: 'https://example.com' })).json().error.message, /غير موجود/, 'a link is not wording');
  assert.equal((await put({ block: 'nowhere', path: 'title', lang: 'ar', value: 'x' })).statusCode, 400);

  const list = (await app.inject({ method: 'GET', url: '/api/admin/content', headers: { authorization: `Bearer ${token}` } })).json();
  const title = list.items.find((item: { block: string; path: string }) => item.block === 'hq' && item.path === 'title');
  assert.deepEqual([title.ar, title.arEdit.value, title.en, title.enEdit.value], ['مقر النادي', 'مقر النادي بالرياض', 'Club HQ', 'The Club HQ']);
  assert.deepEqual(list.edited, { ar: 1, en: 1 });
  assert.deepEqual(list.blocks.map((block: { key: string }) => block.key), ['home', 'membership', 'services', 'golden', 'hq', 'about', 'videos', 'guide', 'forms', 'meetups']);
  assert.ok(list.items.every((item: { en: string }) => item.en.length > 0), 'every text has an English default');

  // Back to the block's own text: by asking for it, or by typing it again.
  assert.equal((await put({ block: 'hq', path: 'title', lang: 'ar', value: null })).json().edit, null);
  assert.equal((await put({ block: 'hq', path: 'title', lang: 'en', value: 'Club HQ' })).json().edit, null);
  assert.equal((await get('/api/hq')).json().content.title, 'مقر النادي');
  assert.equal((await get('/api/hq', 'en')).json().content.title, 'Club HQ');
});

// M81 «صور التطبيق»: code-defined slots, filled by uploads from the dashboard, read inside hq/services.
test('the image slots fill from the dashboard and ride into the hq gallery and the service pages', async () => {
  const slots = await app.inject({ method: 'GET', url: '/api/admin/content/images', headers: { authorization: `Bearer ${token}` } });
  assert.equal(slots.statusCode, 200, slots.body);
  const listed = slots.json().slots as { key: string; url: string | null }[];
  assert.ok(listed.some((slot) => slot.key === 'hq.1'));
  const serviceSlot = listed.find((slot) => slot.key.startsWith('service.'));
  assert.ok(serviceSlot, 'every service gets a slot');

  const putImage = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: '/api/admin/content/image', payload, headers: { authorization: `Bearer ${token}` } });
  assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/content/image', payload: { key: 'hq.1', url: 'https://cdn.example.test/media/a.webp' } })).statusCode, 401);
  assert.equal((await putImage({ key: 'nowhere', url: 'https://cdn.example.test/media/a.webp' })).statusCode, 404);

  assert.equal((await putImage({ key: 'hq.2', url: 'https://cdn.example.test/media/hall.webp' })).statusCode, 200);
  assert.deepEqual((await get('/api/hq')).json().photos, ['https://cdn.example.test/media/hall.webp']);

  const serviceKey = (serviceSlot as { key: string }).key.slice('service.'.length);
  assert.equal((await putImage({ key: `service.${serviceKey}`, url: 'https://cdn.example.test/media/studio.webp' })).statusCode, 200);
  const services = (await get('/api/services')).json().services as { key: string; imageUrl: string | null }[];
  assert.equal(services.find((service) => service.key === serviceKey)?.imageUrl, 'https://cdn.example.test/media/studio.webp');
  const one = await get(`/api/services/${serviceKey}`);
  assert.equal(one.json().service.imageUrl, 'https://cdn.example.test/media/studio.webp');

  // Clearing empties the slot again.
  assert.equal((await putImage({ key: 'hq.2', url: null })).statusCode, 200);
  assert.deepEqual((await get('/api/hq')).json().photos, []);
});
