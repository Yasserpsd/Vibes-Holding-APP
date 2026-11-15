import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { CODES_EN, errorInEnglish, localizeError, PATTERNS_EN, SENTENCES_EN } from './errorEnglish.js';
import { AI_BY, EnglishSweep } from './content/englishSweep.js';
import { readEdits } from './content/edits.js';
import { HOME_SEED } from './content/home.js';
import { wordingOf } from './content/i18n.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';
import type { Translator } from './translate.js';
import { TemplateBlurbWriter } from './videos/blurbs.js';
import { VIDEOS_SNAPSHOT_KEY, VIDEO_ENGLISH_KEY, VideosService } from './videos/service.js';

// M122: the English app hears English everywhere — the hub learns the registration language,
// member mails and pushes follow the device language, and the English sweep rewrites any
// Arabic that leaks into the English content.

/** The mock hub, remembering every op payload the server sends it. */
class RecordingHub extends MockHubClient {
  readonly calls: { op: string; body: Record<string, unknown> }[] = [];

  override call(op: Parameters<MockHubClient['call']>[0], body: Record<string, unknown>) {
    this.calls.push({ op, body });
    return super.call(op, body);
  }
}

const lastCall = (op: string) => [...hub.calls].reverse().find((entry) => entry.op === op);

const config = loadConfig({
  LOG_LEVEL: 'silent',
  HUB_MODE: 'mock',
  NEWS_REFRESH_MINUTES: '0',
  VIDEOS_REFRESH_MINUTES: '0',
  PUBLIC_URL: 'http://localhost:3000',
});
const kv = new MemoryKV();
const mailer = new LogMailer();
const hub = new RecordingHub();

type PushMessage = { to: string; title: string; body: string };
const pushBatches: PushMessage[][] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchStub: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://exp.host/--/api/v2/push/send') {
    const messages = JSON.parse(String(init?.body)) as PushMessage[];
    pushBatches.push(messages);
    return json({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) });
  }
  throw new Error(`unexpected fetch ${url}`);
};

let built: BuiltApp;
let app: BuiltApp['app'];

before(async () => {
  built = await buildApp({ config, kv, hub, blurbs: new TemplateBlurbWriter(), fetchImpl: fetchStub, mailer });
  app = built.app;
  await app.ready();
});

after(async () => {
  await app.close();
});

const post = (url: string, payload: Record<string, unknown>, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload, headers });

let phoneSeq = 340;

async function signUp(email: string, lang: 'ar' | 'en'): Promise<{ token: string; contactId: number }> {
  const headers = { 'x-app-lang': lang };
  phoneSeq += 1;
  const registered = await post(
    '/api/auth/register',
    { name: 'Lana Carter', phone: `051234${String(phoneSeq).padStart(4, '0')}`, email, password: 'secret1', persona: 'investor', bio: 'عضو التجارب لاختبار اللغة في M122' },
    headers,
  );
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE }, headers);
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token, contactId: verified.json().me.id };
}

test('M122: the hub register op carries the app language', async () => {
  await signUp('lang-en@test.local', 'en');
  assert.equal(lastCall('register')?.body.lang, 'en', 'the English app registers with lang=en');
  await signUp('lang-ar@test.local', 'ar');
  assert.equal(lastCall('register')?.body.lang, 'ar');
});

test('M122: member pushes speak each device\'s language', async () => {
  const { token, contactId } = await signUp('push-lang@test.local', 'en');
  const english = await post('/api/push/tokens', { token: 'ExpoPushToken[en-device-1]', platform: 'android' }, { authorization: `Bearer ${token}`, 'x-app-lang': 'en' });
  assert.equal(english.statusCode, 200, english.body);
  const arabic = await post('/api/push/tokens', { token: 'ExpoPushToken[ar-device-1]', platform: 'android' }, { authorization: `Bearer ${token}`, 'x-app-lang': 'ar' });
  assert.equal(arabic.statusCode, 200, arabic.body);

  pushBatches.length = 0;
  built.push.staffReplied(contactId);
  await built.push.idle();
  const sent = pushBatches.flat();
  assert.equal(sent.length, 2, 'both devices heard it');
  const enMessage = sent.find((message) => message.to === 'ExpoPushToken[en-device-1]');
  const arMessage = sent.find((message) => message.to === 'ExpoPushToken[ar-device-1]');
  assert.equal(enMessage?.title, 'A reply from the club team');
  assert.match(arMessage?.title ?? '', /رد من فريق النادي/);
});

test('M122: the persona change code mail follows the app language', async () => {
  const { token } = await signUp('persona-mail@test.local', 'en');
  const asked = await post('/api/me/persona/request', { persona: 'entrepreneur' }, { authorization: `Bearer ${token}`, 'x-app-lang': 'en' });
  assert.equal(asked.statusCode, 200, asked.body);
  const mail = mailer.sent.at(-1);
  assert.match(mail?.subject ?? '', /category change code/i);
  assert.match(mail?.text ?? '', /Entrepreneur — I have a project/);
});

test('M122: the English sweep translates an Arabic edit into an AI English edit', async () => {
  const path = wordingOf(HOME_SEED)[0]?.path;
  assert.ok(path, 'the home seed has wording');
  const sweepKv = new MemoryKV();
  await sweepKv.set('content:edits:home:ar', { edits: { [path]: { value: 'نص عربي جديد من المالك', by: 'Owner', at: new Date().toISOString() } }, updatedAt: '' });
  const translator: Translator = { mode: 'openai', translate: async (texts) => texts.map(() => 'A fresh English line') };
  const sweep = new EnglishSweep({ kv: sweepKv, translator, log: app.log });
  const outcome = await sweep.run();
  assert.ok(outcome.translated >= 1, `translated ${outcome.translated}`);
  const stored = await readEdits(sweepKv, 'home', 'en');
  assert.equal(stored.edits[path]?.value, 'A fresh English line');
  assert.equal(stored.edits[path]?.by, AI_BY);
  // A second pass finds nothing stale and rewrites nothing.
  const again = await sweep.run();
  assert.equal(again.translated, 0);
});

test('M122: the English app reads videos through their stored translation', async () => {
  const videosKv = new MemoryKV();
  const video = { id: 'AAAAAAAAAAA', title: 'عنوان عربي', description: 'وصف عربي', publishedAt: '2026-01-01T00:00:00Z', thumbnail: 'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg', firstSeenAt: '2026-01-01T00:00:00Z' };
  await videosKv.set(VIDEOS_SNAPSHOT_KEY, { channel: null, mode: 'rss', fetchedAt: '2026-01-01T00:00:00Z', lastError: null, videos: [video] });
  await videosKv.set(VIDEO_ENGLISH_KEY, { AAAAAAAAAAA: { title: 'An English title', description: 'An English description', blurb: 'An English blurb', hash: 'x', at: '2026-01-01T00:00:00Z' } });
  const service = new VideosService({ kv: videosKv, config, log: app.log, blurbs: new TemplateBlurbWriter() });
  await service.start();
  const english = await service.list({ page: 1, limit: 10 }, 'en');
  assert.equal(english.items[0]?.title, 'An English title');
  assert.equal(english.items[0]?.blurb, 'An English blurb');
  const arabic = await service.list({ page: 1, limit: 10 }, 'ar');
  assert.equal(arabic.items[0]?.title, 'عنوان عربي');
});

test('M239: the English app never shows Arabic hashtag lines from a video description', async () => {
  const videosKv = new MemoryKV();
  const video = { id: 'WF2X6_lXmRo', title: 'Sky Talk', description: 'Our CEO on the market.\n\n#وديني_سكاي #Investing\n#نادي_المستثمرين', publishedAt: '2026-01-01T00:00:00Z', thumbnail: 'https://i.ytimg.com/vi/WF2X6_lXmRo/hqdefault.jpg', firstSeenAt: '2026-01-01T00:00:00Z' };
  await videosKv.set(VIDEOS_SNAPSHOT_KEY, { channel: null, mode: 'rss', fetchedAt: '2026-01-01T00:00:00Z', lastError: null, videos: [video] });
  const service = new VideosService({ kv: videosKv, config, log: app.log, blurbs: new TemplateBlurbWriter() });
  await service.start();
  const english = await service.list({ page: 1, limit: 10 }, 'en');
  assert.equal(english.items[0]?.description, 'Our CEO on the market.\n\n#Investing');
  const arabic = await service.list({ page: 1, limit: 10 }, 'ar');
  assert.match(arabic.items[0]?.description ?? '', /#وديني_سكاي/u);
});

test('M239: the Arabic app reads English-only videos through their stored Arabic translation', async () => {
  const videosKv = new MemoryKV();
  const video = { id: 'BBBBBBBBBBB', title: 'Market Outlook', description: 'Our CEO on the market.', publishedAt: '2026-01-01T00:00:00Z', thumbnail: 'https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg', firstSeenAt: '2026-01-01T00:00:00Z' };
  await videosKv.set(VIDEOS_SNAPSHOT_KEY, { channel: null, mode: 'rss', fetchedAt: '2026-01-01T00:00:00Z', lastError: null, videos: [video] });
  const translatorAr: Translator = { mode: 'openai', translate: async (texts) => texts.map((text) => (text ? 'نص عربي' : '')) };
  const quiet = { ...config, VIDEOS_REFRESH_MINUTES: 0 };
  const service = new VideosService({ kv: videosKv, config: quiet, log: app.log, blurbs: new TemplateBlurbWriter(), translatorAr });
  await service.start();
  assert.equal((await service.list({ page: 1, limit: 10 }, 'ar')).items[0]?.title, 'Market Outlook');
  await (service as unknown as { writeArabic(v: unknown[]): Promise<void> }).writeArabic([{ ...video }]);
  assert.equal((await service.list({ page: 1, limit: 10 }, 'ar')).items[0]?.title, 'نص عربي');
  assert.equal((await service.list({ page: 1, limit: 10 }, 'en')).items[0]?.title, 'Market Outlook');
});

// M242 (complaint «عربي في وضع الإنجليزية»): every refusal was written in Arabic only, so the English app showed
// its general «something went wrong». The fixed English sentences live in errorEnglish.ts — no AI call.
const ARABIC_LETTER = /[؀-ۿ]/;

test('M242: the English app reads a refusal in English; the Arabic app reads it as before', async () => {
  const ask = (method: 'GET' | 'POST', url: string, lang: 'ar' | 'en', payload?: Record<string, unknown>) =>
    app.inject({ method, url, ...(payload ? { payload } : {}), headers: { 'x-app-lang': lang } });
  const refusals: [method: 'GET' | 'POST', url: string, payload: Record<string, unknown> | undefined, status: number, code: string, arabic: string, english: string][] = [
    ['GET', '/api/projects/999999', undefined, 404, 'not_found', 'المشروع غير موجود', 'This project does not exist.'],
    ['GET', '/api/projects/abc', undefined, 400, 'bad_request', 'رقم المشروع غير صالح', 'The project number is not valid.'],
    ['GET', '/api/me', undefined, 401, 'unauthorized', 'سجّل الدخول أولًا', 'Sign in first.'],
    ['GET', '/api/news/zzz', undefined, 400, 'invalid', 'رقم الخبر غير صالح', 'The news item number is not valid.'],
    ['GET', '/api/no-such-route', undefined, 404, 'not_found', 'المسار غير موجود', 'This address does not exist.'],
    ['GET', '/api/golden/offer/zz', undefined, 404, 'not_found', 'الشركة غير موجودة', 'This company does not exist.'],
    // The generic validation sentence (a field of the wrong type has no Arabic message of its own).
    ['POST', '/api/auth/login', { login: 5 }, 400, 'invalid', 'البيانات غير مكتملة أو غير صحيحة', 'Some of the details are missing or not valid.'],
    ['POST', '/api/auth/register', { name: 'Lana Carter', phone: '0512340999', email: 'lana@gmail..com', password: 'secret1', persona: 'investor' }, 400, 'invalid', 'اكتب بريدًا إلكترونيًا صحيحًا (مثل name@example.com)', 'Enter a valid email (for example name@example.com).'],
    // A sentence of the hub's own, with no twin: the general English of its code.
    ['POST', '/api/auth/login', { login: 'lang-en@test.local', password: 'wrong-pass' }, 401, 'bad_login', '', 'The email or mobile number, or the password, is wrong.'],
  ];
  for (const [method, url, payload, status, code, arabic, english] of refusals) {
    const inEnglish = await ask(method, url, 'en', payload);
    assert.deepEqual([inEnglish.statusCode, inEnglish.json().error.code, inEnglish.json().error.message], [status, code, english], `${method} ${url}`);
    assert.equal(inEnglish.headers['cache-control'], 'no-store', 'rule 8 holds on a refusal');
    const inArabic = await ask(method, url, 'ar', payload);
    assert.deepEqual([inArabic.statusCode, inArabic.json().error.code], [status, code]);
    if (arabic) assert.equal(inArabic.json().error.message, arabic, `${method} ${url} (Arabic unchanged)`);
    else assert.match(inArabic.json().error.message, ARABIC_LETTER);
  }
});

test('M242: an answer that is not a refusal, or is already English, passes through untouched', async () => {
  const home = await app.inject({ method: 'GET', url: '/api/home', headers: { 'x-app-lang': 'en' } });
  assert.equal(home.statusCode, 200);
  assert.ok(home.json().hero.title, 'a normal answer is not rewritten');
  assert.deepEqual(localizeError({ error: { code: 'update_required', message: 'Please update Investors Club from the store.' } }, 'en'), { error: { code: 'update_required', message: 'Please update Investors Club from the store.' } });
  const arabic = { error: { code: 'not_found', message: 'المشروع غير موجود' } };
  assert.equal(localizeError(arabic, 'ar'), arabic, 'an Arabic request is never touched');
  assert.deepEqual(localizeError({ error: { code: 'not_found', message: 'المشروع غير موجود', details: { id: 7 } } }, 'en'), { error: { code: 'not_found', message: 'This project does not exist.', details: { id: 7 } } });
  // A number rides into the English sentence as it came.
  assert.equal(errorInEnglish('wallet_exhausted', 'رصيد ساعاتك السنوي لا يكفي: المتبقي 3 من 24 ساعة'), 'Your annual hours balance is not enough: 3 of 24 hours left.');
  assert.equal(errorInEnglish('invalid', 'اختر 5 اهتمامات كحد أقصى'), 'Choose at most 5 interests.');
  // No twin and no general sentence for the code: nothing is invented; the Arabic stands.
  assert.equal(errorInEnglish('some_new_code', 'جملة جديدة بلا مقابل'), null);
  assert.deepEqual(localizeError({ error: { code: 'some_new_code', message: 'جملة جديدة بلا مقابل' } }, 'en'), { error: { code: 'some_new_code', message: 'جملة جديدة بلا مقابل' } });
});

test('M242: every English sentence still has its Arabic in the code, and follows the house wording', () => {
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && entry.name !== 'errorEnglish.ts') sources.push(readFileSync(path, 'utf8'));
    }
  };
  walk(dirname(fileURLToPath(import.meta.url)));
  const code = sources.join('\n');
  // An Arabic sentence edited at its source must not silently lose its English twin.
  const stale = Object.keys(SENTENCES_EN).filter((arabic) => !code.includes(arabic));
  assert.deepEqual(stale, [], 'these Arabic sentences are no longer in the server code');
  const english = [...Object.values(SENTENCES_EN), ...Object.values(CODES_EN), ...PATTERNS_EN.map(([, write]) => write(['', '3', '5']))];
  for (const sentence of english) {
    assert.ok(sentence.trim().length > 3 && !ARABIC_LETTER.test(sentence), sentence);
    assert.ok(!/\bfree\b|e-mail|administration|guarantee|profit/i.test(sentence), `house wording: ${sentence}`);
  }
});
