import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { speakable, SPEECH_MAX_CHARS } from './advisor/speech.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { MemoryKV } from './store.js';

// M148 «المستشار يرد بالصوت»: a reply's text becomes an MP3 clip through OpenAI TTS — members only,
// markdown stripped first, the same reply synthesised once, and the app receives base64 (never a file on disk).

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', OPENAI_API_KEY: 'sk-test-speech-key-0123456789' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];

/** A fake MP3: 3 KB that starts like one. */
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(3000, 7)]);
const speechCalls: { input: string; lang: string; model: string; voice: string }[] = [];
let speechStatus = 200;
const fetchStub: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://api.openai.com/v1/audio/speech') {
    const body = JSON.parse(String(init?.body)) as { input: string; instructions: string; model: string; voice: string };
    speechCalls.push({ input: body.input, lang: /[؀-ۿ]/.test(body.instructions) ? 'ar' : 'en', model: body.model, voice: body.voice });
    assert.equal(init?.headers && (init.headers as Record<string, string>).authorization, 'Bearer sk-test-speech-key-0123456789');
    if (speechStatus !== 200) return new Response('refused', { status: speechStatus });
    return new Response(new Uint8Array(MP3), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  if (url === 'https://exp.host/--/api/v2/push/send') return new Response(JSON.stringify({ data: [] }), { status: 200 });
  // Every other OpenAI helper (name judge, classifier) fails open when the network refuses.
  throw new Error(`unexpected fetch: ${url}`);
};

const post = async (url: string, payload: Record<string, unknown>, token?: string, lang?: string) =>
  app.inject({ method: 'POST', url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(lang ? { 'x-app-lang': lang } : {}) } });

async function signUp(email: string, phone: string): Promise<string> {
  const registered = await post('/api/auth/register', {
    name: 'سالم التجريبي',
    country: 'sa',
    phone,
    email,
    password: 'secret123',
    persona: 'entrepreneur',
    bio: 'رائد أعمال يبحث عن شريك في مشروع تقني.',
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200);
  return verified.json().token as string;
}

before(async () => {
  const built = await buildApp({ config, kv, hub: new MockHubClient({ replyDelayMs: 20 }), fetchImpl: fetchStub });
  app = built.app;
  await app.ready();
});

after(async () => {
  await app.close();
});

test('m148: speakable turns the reply markdown into plain sentences', () => {
  const reply = [
    '## خطة النمو 🚀',
    '**أولًا:** راجع [دراسة الجدوى](https://vcmem.com/x) قبل أي خطوة.',
    '| البند | القيمة |',
    '|---|---|',
    '| الإيراد | 120 ألف ريال |',
    '- اطلب رصيدًا من بنك المشاريع',
    '> تذكير: https://vcmem.com/app',
  ].join('\n');
  assert.equal(
    speakable(reply),
    ['خطة النمو', 'أولًا: راجع دراسة الجدوى قبل أي خطوة.', 'البند، القيمة', 'الإيراد، 120 ألف ريال', 'اطلب رصيدًا من بنك المشاريع', 'تذكير:'].join('\n'),
  );
  assert.equal(speakable('   \n\n'), '');
  const long = speakable(`${'جملة طويلة جدًا تتكرر. '.repeat(400)}`);
  assert.ok(long.length <= SPEECH_MAX_CHARS);
  assert.ok(long.endsWith('.'));
});

test('m148: the speak route needs a session and a text', async () => {
  assert.equal((await post('/api/advisor/speak', { text: 'مرحبًا' })).statusCode, 401);
  const token = await signUp('fahd+speak@gmail.com', '0558318800');
  assert.equal((await post('/api/advisor/speak', { text: '' }, token)).statusCode, 400);
  const empty = await post('/api/advisor/speak', { text: '**  **' }, token);
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.json().error.code, 'empty');
});

test('m148: a reply comes back as base64 MP3 in the member language, synthesised once', async () => {
  const token = await signUp('noura+speak@gmail.com', '0558318801');
  speechCalls.length = 0;
  const first = await post('/api/advisor/speak', { text: '**أهلًا بك** في نادي المستثمرين.' }, token);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.headers['cache-control'], 'no-store');
  const body = first.json() as { audio: string; mime: string; chars: number };
  assert.equal(body.mime, 'audio/mpeg');
  assert.ok(Buffer.from(body.audio, 'base64').equals(MP3));
  assert.equal(body.chars, 'أهلًا بك في نادي المستثمرين.'.length);
  assert.equal(speechCalls.length, 1);
  assert.equal(speechCalls[0]?.input, 'أهلًا بك في نادي المستثمرين.');
  assert.equal(speechCalls[0]?.lang, 'ar');
  assert.equal(speechCalls[0]?.model, 'gpt-4o-mini-tts');

  // The same reply again: served from memory, OpenAI not called.
  const again = await post('/api/advisor/speak', { text: '**أهلًا بك** في نادي المستثمرين.' }, token);
  assert.equal(again.statusCode, 200);
  assert.equal(speechCalls.length, 1);

  // English members get the English delivery instructions.
  const english = await post('/api/advisor/speak', { text: 'Welcome to the club.' }, token, 'en');
  assert.equal(english.statusCode, 200);
  assert.equal(speechCalls[1]?.lang, 'en');
});

test('m148: an OpenAI refusal is a 502 the app can show', async () => {
  const token = await signUp('rana+speak@gmail.com', '0558318802');
  speechStatus = 500;
  try {
    const failed = await post('/api/advisor/speak', { text: 'نص لا يُنطق اليوم.' }, token);
    assert.equal(failed.statusCode, 502);
    assert.equal(failed.json().error.code, 'speech_failed');
  } finally {
    speechStatus = 200;
  }
});
