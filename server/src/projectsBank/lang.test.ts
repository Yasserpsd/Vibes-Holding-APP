import assert from 'node:assert/strict';
import { test } from 'node:test';

import Fastify from 'fastify';

import { MemoryKV } from '../store.js';
import { BRIEF_DISCLAIMER, BRIEF_DISCLAIMER_EN, BriefService, briefKey } from './brief.js';
import { localizeFilters, localizeProject } from './lang.js';
import type { ProjectsFilters, PublicProject } from './types.js';

/** M27 stage 4: the Projects Bank as the English app reads it. */

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

const TECH = { slug: 'tech', name: 'التكنولوجيا والبرمجيات' };
const bilingual = project({
  id: 1,
  number: '10',
  title: 'منصة فاهم القانونية',
  titleEn: 'Fahem Legal Platform',
  companyName: 'شركة فاهم',
  companyNameEn: 'Fahem Company',
  excerpt: 'مساعد قانوني ذكي.',
  excerptEn: 'An intelligent legal assistant.',
  details: 'منصة تربط المستخدم بالمعلومة القانونية وتعمل في 3 مدن.\nنموذج العمل: اشتراك شهري.',
  detailsEn: 'A platform that connects users with legal information, operating in 3 cities.\nBusiness model: monthly subscription.',
  sector: TECH,
  stage: { slug: 'launch', name: 'إطلاق وتشغيل' },
});
const arabicOnly = project({ id: 2, title: 'تطبيق مواعيد', sector: TECH, stage: { slug: 'growth', name: 'نمو وتوسع · تقدير المستشار', estimated: true }, excerpt: 'تطبيق يحجز المواعيد للمرضى ويعمل في 3 مدن.' });
const other = project({ id: 3, title: 'مزرعة', sector: { slug: 'x', name: 'قطاع غير معروف' }, excerpt: 'مزرعة خضار.' });

test('the English app gets the founder\'s English fields, the Arabic where there is none, and the terms\' English names', () => {
  const english = localizeProject(bilingual, 'en');
  assert.deepEqual([english.title, english.titleEn, english.companyName, english.companyNameEn, english.excerpt, english.details?.split('\n')[0]], ['Fahem Legal Platform', null, 'Fahem Company', null, 'An intelligent legal assistant.', 'A platform that connects users with legal information, operating in 3 cities.']);
  assert.deepEqual([english.sector?.name, english.sector?.slug, english.stage?.name], ['Technology and Software', 'tech', 'Launch and operation']);

  const fallback = localizeProject(arabicOnly, 'en');
  assert.deepEqual([fallback.title, fallback.titleEn, fallback.excerpt, fallback.stage?.name, fallback.stage?.estimated], ['تطبيق مواعيد', null, 'تطبيق يحجز المواعيد للمرضى ويعمل في 3 مدن.', "Growth and expansion · adviser's estimate", true]);
  assert.equal(localizeProject(other, 'en').sector?.name, 'قطاع غير معروف', 'a sector the list does not know keeps its name');
  assert.equal(localizeProject(bilingual, 'ar'), bilingual, 'Arabic is the feed as it is');
});

test('filters and sort labels follow the language', () => {
  const filters: ProjectsFilters = {
    sectors: [{ slug: 'tech', name: 'التكنولوجيا والبرمجيات', count: 59 }, { slug: 'other', name: 'أخرى', count: 31 }],
    stages: [{ slug: 'idea', name: 'فكرة', count: 6 }, { slug: 'revenue', name: 'تحقيق الدخل', count: 49 }],
    sorts: [{ key: 'latest', label: 'الأحدث' }, { key: 'golden', label: 'الذهبية' }],
    updatedAt: null,
  };
  const english = localizeFilters(filters, 'en');
  assert.deepEqual(english.sectors.map((option) => option.name), ['Technology and Software', 'Other']);
  assert.deepEqual(english.stages.map((option) => [option.slug, option.name]), [['idea', 'Idea'], ['revenue', 'Revenue']]);
  assert.deepEqual(english.sorts.map((sort) => sort.label), ['Latest', 'Golden Projects']);
  assert.equal(localizeFilters(filters, 'ar'), filters);
});

test('the brief is written in the app\'s language and cached apart from the Arabic one', async () => {
  const kv = new MemoryKV();
  const service = new BriefService({ kv, log: Fastify({ logger: false }).log, model: 'none' });
  const all = [bilingual, arabicOnly, other];
  const english = await service.brief(bilingual, all, Date.now(), 'en');
  assert.equal(english.disclaimer, BRIEF_DISCLAIMER_EN);
  assert.deepEqual(english.table.slice(0, 4).map((row) => [row.label, row.value]), [['Project number', '10'], ['Company', 'Fahem Company'], ['Sector', 'Technology and Software'], ['Stage', 'Launch and operation']]);
  assert.deepEqual([english.stage.label, english.stage.steps[0], english.stage.steps[4]], ['Launch and operation', 'Idea', 'Growth and expansion']);
  assert.equal(english.summary, 'An intelligent legal assistant.');
  assert.ok(english.table.some((row) => row.label === 'Business model' && row.value === 'monthly subscription.'), 'the founder\'s English «label: value» line');
  assert.ok(english.risks.every((risk) => !/[؀-ۿ]/.test(risk)) && english.strengths.every((line) => !/[؀-ۿ]/.test(line)));
  const rival = english.competitors.find((row) => row.id === 2);
  assert.ok(rival && rival.title === 'تطبيق مواعيد' && rival.sector === 'Technology and Software' && rival.why.startsWith('Works in the same sector (Technology and Software)'), JSON.stringify(rival));

  const arabic = await service.brief(bilingual, all, Date.now(), 'ar');
  assert.deepEqual([arabic.disclaimer, arabic.table[0]?.label, arabic.stage.label], [BRIEF_DISCLAIMER, 'رقم المشروع', 'إطلاق وتشغيل']);
  assert.ok((await kv.get(briefKey(1))) && (await kv.get(briefKey(1, 'en'))), 'two cache entries');
  assert.notEqual(briefKey(1), briefKey(1, 'en'));
});
