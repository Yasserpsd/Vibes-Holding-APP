import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
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
