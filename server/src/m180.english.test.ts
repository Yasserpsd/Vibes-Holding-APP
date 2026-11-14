import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import Fastify from 'fastify';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { ProjectsEnglish } from './projectsBank/english.js';
import { localizeProject, useProjectsEnglish } from './projectsBank/lang.js';
import type { PublicProject } from './projectsBank/types.js';
import { MemoryKV } from './store.js';
import type { Translator } from './translate.js';

// M180 (owner: «مينفعش الاقي كلمة واحدة عربي لما احوله انجليزي»): admin messages and the Projects Bank read fully
// in English — links, poll options, names — and a message that missed its English gets it on the next pass.
const config = loadConfig({
  LOG_LEVEL: 'silent',
  HUB_MODE: 'mock',
  NEWS_REFRESH_MINUTES: '0',
  VIDEOS_REFRESH_MINUTES: '0',
  NOTIFY_EMAIL: 'admin@vcmem.com',
  OPENAI_API_KEY: 'sk-test-translation-key',
});

let openaiDown = false;
const fetchStub: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://exp.host/--/api/v2/push/send') {
    const messages = JSON.parse(String(init?.body)) as unknown[];
    return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) }), { status: 200 });
  }
  if (url === 'https://api.openai.com/v1/chat/completions') {
    if (openaiDown) return new Response('{}', { status: 503 });
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const request = JSON.parse(body.messages[1]?.content ?? '{}') as { texts: string[] };
    const texts = request.texts.map((text, index) => (text.trim() ? `English ${index}` : ''));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ texts }) } }] }), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${url}`);
};

let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const getEn = (url: string) => app.inject({ method: 'GET', url, headers: { 'x-app-lang': 'en' } });
const send = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown>, token?: string) => app.inject({ method, url, payload, headers: bearer(token) });

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub: new MockHubClient(), mailer: new LogMailer(), fetchImpl: fetchStub });
  app = built.app;
  const registered = await send('POST', '/api/auth/register', { name: 'سالم الترجمان', country: 'sa', phone: '0558618862', email: 'm180.admin@gmail.com', password: 'secret123', persona: 'neutral', bio: 'حساب اختبار الترجمة الكاملة للنسخة الإنجليزية.' });
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  adminToken = verified.json().token as string;
});

after(async () => {
  await app.close();
});

const ARABIC = /[؀-ۿ]/;

test('links and poll options read in English too', async () => {
  const created = await send(
    'POST',
    '/api/admin/posts',
    { title: 'ما أفضل موعد؟', body: 'اختر الموعد.', kind: 'poll', status: 'published', links: [{ label: 'التفاصيل', url: 'https://vcmem.com' }], poll: { options: [{ label: 'السبت' }, { label: 'الأحد' }], resultsVisible: true } },
    adminToken,
  );
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().post.id as string;
  const post = (await getEn(`/api/posts/${id}`)).json().post as { title: string; body: string; links: { label: string }[]; poll: { options: { label: string }[] } };
  assert.equal(post.title, 'English 0');
  assert.deepEqual(post.links.map((link) => link.label), ['English 3']);
  assert.deepEqual(post.poll.options.map((option) => option.label), ['English 4', 'English 5']);
  assert.ok(!ARABIC.test(JSON.stringify(post)));
});

test('a message whose translation failed gets its English on the next pass', async () => {
  openaiDown = true;
  const created = await send('POST', '/api/admin/posts', { title: 'رسالة بلا ترجمة', body: 'نص عربي.', status: 'published' }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().post.id as string;
  assert.equal((await getEn(`/api/posts/${id}`)).json().post.title, 'رسالة بلا ترجمة');
  openaiDown = false;
  await built.postsEnglish.run();
  const post = (await getEn(`/api/posts/${id}`)).json().post as { title: string; body: string };
  assert.equal(post.title, 'English 0');
  assert.equal(post.body, 'English 1');
});

const project = (overrides: Partial<PublicProject>): PublicProject => ({
  id: 7,
  number: null,
  slug: null,
  title: 'منصة توصيل',
  titleEn: null,
  companyName: 'شركة الريان',
  companyNameEn: null,
  founderName: 'محمد العتيبي',
  founderNameEn: null,
  excerpt: 'ملخص المشروع. للتواصل 0551234567',
  excerptEn: null,
  details: 'تفاصيل المشروع',
  detailsEn: 'Founder English details',
  image: null,
  gallery: [],
  sector: { slug: 'new', name: 'قطاع جديد' },
  stage: null,
  isGolden: false,
  featuredOrder: null,
  goldenPartnerUrl: null,
  hasPitchDeck: false,
  contactRule: null,
  viewsCount: 0,
  modifiedAt: null,
  ...overrides,
});

test('Projects Bank: AI fills what the founder left without English; contacts never reach the translator', async () => {
  const seen: string[][] = [];
  const translator: Translator = {
    mode: 'openai',
    translate: async (texts) => {
      seen.push(texts);
      return texts.map((text) => (text ? `EN-${texts.indexOf(text)}` : ''));
    },
  };
  let current = project({});
  const english = new ProjectsEnglish({ kv: new MemoryKV(), translator, log: Fastify({ logger: false }).log, all: () => [current] });
  useProjectsEnglish(english);
  try {
    await english.run();
    assert.equal(seen.length, 1);
    assert.ok(!seen[0]?.some((text) => text.includes('0551234567')), 'the phone number stays out of the translator');
    const shown = localizeProject(current, 'en');
    assert.equal(shown.title, 'EN-0');
    assert.equal(shown.companyName, 'EN-1');
    assert.equal(shown.founderName, 'EN-2');
    assert.equal(shown.excerpt, 'EN-3');
    assert.equal(shown.details, 'Founder English details');
    assert.equal(shown.sector?.name, 'EN-4');
    assert.equal(localizeProject(current, 'ar').title, 'منصة توصيل');

    await english.run();
    assert.equal(seen.length, 1, 'unchanged Arabic is never translated twice');
    current = project({ title: 'منصة توصيل سريعة' });
    assert.equal(localizeProject(current, 'en').companyName, 'شركة الريان', 'a stale translation is not shown');
    await english.run();
    assert.equal(seen.length, 2);
    assert.equal(localizeProject(current, 'en').companyName, 'EN-1');
  } finally {
    useProjectsEnglish(built.projectsEnglish);
  }
});

test('M239: a title or company name that stays Arabic is repaired, only the missing fields are asked', async () => {
  const seen: string[][] = [];
  let stubborn = true;
  const translator: Translator = {
    mode: 'openai',
    // Like the model that hands a short Arabic name back unchanged.
    translate: async (texts) => {
      seen.push(texts);
      return texts.map((text) => (text ? (stubborn && ARABIC.test(text) && text.length < 8 ? text : `EN-${text.length}`) : ''));
    },
  };
  const current = project({ title: 'آمن', companyName: 'شركة الأمان', founderName: 'محمد العتيبي', detailsEn: 'Founder English details' });
  const english = new ProjectsEnglish({ kv: new MemoryKV(), translator, log: Fastify({ logger: false }).log, all: () => [current] });
  useProjectsEnglish(english);
  try {
    await english.run();
    const shown = localizeProject(current, 'en');
    assert.ok(!ARABIC.test(shown.title), 'the short title gets a Latin spelling');
    assert.equal(shown.title, 'Amn');
    assert.ok(!ARABIC.test(shown.companyName ?? ''));
    assert.ok(!ARABIC.test(shown.founderName ?? ''));
    const calls = seen.length;
    await english.run();
    assert.equal(seen.length, calls, 'a repaired project is not asked again');
  } finally {
    stubborn = false;
    useProjectsEnglish(built.projectsEnglish);
  }
});

test('M239: a founder «English» field holding Arabic letters is not English (live rows 7018 / 6584)', async () => {
  const seen: string[][] = [];
  const translator: Translator = { mode: 'openai', translate: async (texts) => { seen.push(texts); return texts.map((text) => (text ? 'Aman Co' : '')); } };
  const live = project({ title: 'آمن', titleEn: 'آمن', companyName: 'Cenemato', companyNameEn: 'سينما سيارات', founderName: 'Saad Alharbi', founderNameEn: 'Saad Alharbi', excerpt: 'Short text', excerptEn: 'Short text', detailsEn: 'Founder English details' });
  const real = project({ id: 8, title: 'آمن', titleEn: 'Aman', companyName: 'شركة الأمان', companyNameEn: 'Aman Company', founderNameEn: 'Saad Alharbi', excerptEn: 'Short text' });
  const english = new ProjectsEnglish({ kv: new MemoryKV(), translator, log: Fastify({ logger: false }).log, all: () => [live, real] });
  useProjectsEnglish(english);
  try {
    await english.run();
    const shown = localizeProject(live, 'en');
    assert.ok(!ARABIC.test(shown.title) && !ARABIC.test(shown.companyName ?? ''));
    assert.equal(shown.companyName, 'Cenemato', 'the Latin site name wins without a model call');
    assert.ok(seen.every((texts) => !texts.includes('Cenemato')), 'a Latin value is never sent to the translator');
    const kept = localizeProject(real, 'en');
    assert.equal(kept.title, 'Aman', 'a real English founder value still wins');
    assert.equal(kept.companyName, 'Aman Company');
    assert.ok(seen.every((texts) => !texts.includes('Aman Company')), 'a real English value is never sent to the translator');
  } finally {
    useProjectsEnglish(built.projectsEnglish);
  }
});

test('M239: a clean cache from an earlier pass costs no model call', async () => {
  const seen: string[][] = [];
  const translator: Translator = { mode: 'openai', translate: async (texts) => { seen.push(texts); return texts.map((text) => (text ? 'Safe Co' : '')); } };
  const kv = new MemoryKV();
  const current = project({ title: 'آمن' });
  const first = new ProjectsEnglish({ kv, translator: { mode: 'openai', translate: async (texts) => texts.map((text) => (text ? 'ok' : '')) }, log: Fastify({ logger: false }).log, all: () => [current] });
  await first.run();
  const second = new ProjectsEnglish({ kv, translator, log: Fastify({ logger: false }).log, all: () => [current] });
  await second.run();
  assert.equal(seen.length, 0, 'a clean cache costs no model call');
});
