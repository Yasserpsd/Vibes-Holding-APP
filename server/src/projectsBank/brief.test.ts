import assert from 'node:assert/strict';
import { test } from 'node:test';

import Fastify from 'fastify';

import { MemoryKV } from '../store.js';
import { BRIEF_DISCLAIMER, BriefService, briefKey, pickCompetitors, stageOf } from './brief.js';
import { hasContact, stripContacts } from './redact.js';
import type { PublicProject } from './types.js';

const log = Fastify({ logger: false }).log;

const project = (overrides: Partial<PublicProject>): PublicProject => ({
  id: 1,
  number: null,
  slug: null,
  title: 'مشروع',
  titleEn: null,
  companyName: null,
  companyNameEn: null,
  founderName: null,
  founderNameEn: null,
  excerpt: null,
  excerptEn: null,
  details: null,
  detailsEn: null,
  image: null,
  gallery: [],
  sector: null,
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

const TECH = { slug: 'tech', name: 'تقنية' };
const main = project({ id: 1, number: '10', title: 'منصة حجوزات العيادات', sector: TECH, stage: { slug: 's', name: 'إطلاق' }, details: 'منصة تربط المرضى بالعيادات وتعمل في 3 مدن مع 120 عيادة.\nنموذج العمل: اشتراك شهري للعيادات.\nراسلنا: clinic@example.com' });
const rival = project({ id: 2, title: 'تطبيق مواعيد الأطباء', sector: TECH, stage: { slug: 's', name: 'نمو' }, excerpt: 'تطبيق يحجز مواعيد الأطباء للمرضى.' });
const far = project({ id: 3, title: 'مزرعة عضوية', sector: { slug: 'agri', name: 'زراعة' }, excerpt: 'مزرعة خضار.' });
const all = [main, rival, far];

/** An OpenAI stand-in that answers one fixed brief and remembers what it was asked. */
function fakeOpenAI(answer: unknown, status = 200) {
  const requests: { url: string; body: { messages: { content: string }[]; response_format: { type: string } }; key: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)), key: String(new Headers(init?.headers).get('authorization')) });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { status, headers: { 'content-type': 'application/json' } });
  };
  return { requests, fetchImpl };
}

const goodAnswer = {
  summary: 'منصة تربط المرضى بالعيادات وتعمل في 3 مدن مع 120 عيادة، وتحقق دخلها من اشتراك شهري تدفعه العيادات.',
  table: [
    { label: 'العملاء', value: 'العيادات والمرضى' },
    { label: 'نموذج الدخل', value: 'اشتراك شهري للعيادات' },
    { label: 'التواصل', value: 'clinic@example.com' },
    { label: 'حجم السوق', value: '500 مليون ريال' },
  ],
  strengths: ['حضور في 3 مدن مع 120 عيادة', 'خدمة مجانية للمرضى'],
  risks: ['الاعتماد على اشتراك العيادات وحده'],
  competitors: [
    { id: 2, why: 'يخدم الشريحة نفسها من المرضى بحجز المواعيد.' },
    { id: 99, why: 'مشروع لم يُطلب.' },
  ],
  // The site already places this project («إطلاق»): the model's own reading must not replace it.
  stageKey: 'growth',
};

test('stages map to a five-step ladder and competitors are chosen without a model', () => {
  assert.deepEqual([stageOf(main).key, stageOf(main).index], ['launch', 2]);
  assert.deepEqual([stageOf(project({ stage: { slug: 'x', name: 'تشغيل ونمو' } })).key], ['growth']);
  assert.equal(stageOf(project({ stage: { slug: 'x', name: 'مرحلة غريبة' } })).index, -1);
  assert.deepEqual(pickCompetitors(main, all).map((row) => row.project.id), [2]);
  assert.deepEqual(pickCompetitors(main, all), pickCompetitors(main, [far, rival, main]), 'the order of the feed does not matter');
});

test('stripContacts removes phones, e-mails, links and handles but keeps amounts', () => {
  const text = 'رأس المال 2,500,000 ريال و 35% نمو. جوال 0555123456 أو +966 55 512 3456، بريد a.b@site.sa، موقع www.site.sa و https://x.com/abc وحساب @our_shop';
  const clean = stripContacts(text);
  for (const leak of ['0555123456', '512 3456', 'a.b@site.sa', 'www.site.sa', 'x.com', '@our_shop']) assert.ok(!clean.includes(leak), leak);
  assert.ok(clean.includes('2,500,000 ريال') && clean.includes('35%'));
  assert.equal(hasContact(text), true);
  assert.equal(hasContact(clean), false);
});

test('with a key the model words the brief; its rows about contact and its invented numbers are dropped, the wording rules applied', async () => {
  const kv = new MemoryKV();
  const openai = fakeOpenAI(goodAnswer);
  const service = new BriefService({ kv, log, apiKey: 'sk-test-key-000000000000', model: 'gpt-test', fetchImpl: openai.fetchImpl });
  const brief = await service.brief(main, all);
  assert.equal(brief.source, 'ai');
  assert.equal(brief.summary, goodAnswer.summary);
  assert.equal(brief.disclaimer, BRIEF_DISCLAIMER);
  const labels = brief.table.map((row) => row.label);
  assert.ok(labels.includes('رقم المشروع') && labels.includes('العملاء') && labels.includes('نموذج الدخل'));
  assert.ok(!labels.includes('التواصل') && !labels.includes('حجم السوق'), 'no contact row, no number the text does not have');
  assert.deepEqual(brief.strengths, ['حضور في 3 مدن مع 120 عيادة', 'خدمة بدون رسوم للمرضى']);
  assert.deepEqual(brief.competitors, [{ id: 2, title: rival.title, sector: 'تقنية', stage: 'نمو', why: 'يخدم الشريحة نفسها من المرضى بحجز المواعيد.' }]);
  assert.deepEqual([brief.stage.key, brief.stage.index, brief.stage.estimated], ['launch', 2, false], 'the stage of the site wins over the model');

  // What the model saw: public fields only, the founder's e-mail already gone; JSON schema output.
  assert.equal(openai.requests.length, 1);
  const request = openai.requests[0];
  assert.equal(request?.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(request?.body.response_format.type, 'json_schema');
  assert.ok(!JSON.stringify(request?.body).includes('clinic@example.com'));

  // Cached by content: no second call; a changed description asks again.
  await service.brief(main, all);
  assert.equal(openai.requests.length, 1);
  await service.brief({ ...main, details: `${main.details}\nالمطلوب: شريك تقني.` }, all);
  assert.equal(openai.requests.length, 2);
});

test('a project the site does not place («أخرى», empty) takes the reading of the adviser from the description, marked as an estimate', async () => {
  const vague = project({ id: 7, number: '70', title: 'متجر أدوات القهوة', sector: TECH, stage: { slug: 'other', name: 'اخري' }, details: 'متجر إلكتروني يبيع أدوات القهوة المختصة ويحقق مبيعات شهرية منتظمة منذ عام.' });
  const reading = fakeOpenAI({ ...goodAnswer, summary: 'متجر إلكتروني يبيع أدوات القهوة المختصة لهواة القهوة، ويحقق مبيعات شهرية منتظمة منذ عام.', table: [], strengths: [], risks: [], competitors: [], stageKey: 'revenue' });
  const service = new BriefService({ kv: new MemoryKV(), log, apiKey: 'sk-test-key-000000000000', model: 'gpt-test', fetchImpl: reading.fetchImpl });
  const brief = await service.brief(vague, [vague, rival]);
  assert.deepEqual([brief.stage.key, brief.stage.index, brief.stage.label, brief.stage.estimated], ['revenue', 3, 'تحقيق الدخل', true]);

  // «unknown» from the model, or no model at all, leaves the step open and says so.
  const unsure = fakeOpenAI({ ...goodAnswer, summary: 'متجر إلكتروني يبيع أدوات القهوة المختصة لهواة القهوة، ويحقق مبيعات شهرية منتظمة منذ عام.', table: [], strengths: [], risks: [], competitors: [], stageKey: 'unknown' });
  const open = await new BriefService({ kv: new MemoryKV(), log, apiKey: 'sk-test-key-000000000000', model: 'gpt-test', fetchImpl: unsure.fetchImpl }).brief(vague, [vague, rival]);
  assert.deepEqual([open.stage.key, open.stage.index, open.stage.estimated], ['unknown', -1, false]);
  const byRules = await new BriefService({ kv: new MemoryKV(), log, model: 'gpt-test' }).brief(vague, [vague, rival]);
  assert.deepEqual([byRules.stage.index, byRules.stage.estimated, byRules.source], [-1, false, 'rules']);
});

test('an answer that promises returns, a failed call or a broken JSON all fall back to the rules, and the call is tried again later', async () => {
  const promising = fakeOpenAI({ ...goodAnswer, summary: 'منصة تربط المرضى بالعيادات بعائد مضمون للشركاء يصل إلى مستويات عالية خلال عام واحد فقط.' });
  const kv = new MemoryKV();
  const service = new BriefService({ kv, log, apiKey: 'sk-test-key-000000000000', model: 'gpt-test', fetchImpl: promising.fetchImpl });
  const brief = await service.brief(main, all);
  assert.equal(brief.source, 'rules');
  assert.ok(!/مضمون|عائد/.test(JSON.stringify({ ...brief, disclaimer: '' })));
  assert.ok(brief.disclaimer.includes('ليست عرضًا تعاقديًا أو ضمانًا لعوائد'));
  assert.ok(!JSON.stringify(brief).includes('clinic@example.com'));
  const stored = await kv.get<{ retryAt?: number }>(briefKey(main.id));
  assert.ok((stored?.retryAt ?? 0) > Date.now(), 'the rules answer serves until the retry time');
  await service.brief(main, all);
  assert.equal(promising.requests.length, 1, 'not asked again before the retry time');
  await service.brief(main, all, Date.now() + 7 * 3_600_000);
  assert.equal(promising.requests.length, 2);

  const down = fakeOpenAI({}, 500);
  assert.equal((await new BriefService({ kv: new MemoryKV(), log, apiKey: 'sk-test-key-000000000000', model: 'gpt-test', fetchImpl: down.fetchImpl }).brief(main, all)).source, 'rules');
  const shapeless = fakeOpenAI({ summary: 'قصير', extra: true });
  assert.equal((await new BriefService({ kv: new MemoryKV(), log, apiKey: 'sk-test-key-000000000000', model: 'gpt-test', fetchImpl: shapeless.fetchImpl }).brief(main, all)).source, 'rules');

  // No key at all: never a network call.
  const silent = fakeOpenAI(goodAnswer);
  const rules = await new BriefService({ kv: new MemoryKV(), log, model: 'gpt-test', fetchImpl: silent.fetchImpl }).brief(main, all);
  assert.deepEqual([rules.source, silent.requests.length], ['rules', 0]);
});
