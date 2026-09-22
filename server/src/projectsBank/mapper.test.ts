import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractItems } from './feed.js';
import { PRIVATE_FIELDS, toPublicProject } from './mapper.js';
import { htmlToText, normalizeForSearch } from './text.js';

const rawItem = {
  id: 42,
  title: { rendered: 'منصة توصيل' },
  date: '2026-08-01T10:00:00',
  meta: {
    project_number: 'PB-042',
    company_name: 'شركة النقل الذكي',
    founder_name: 'أحمد',
    whatsapp: '0558318777',
    email: 'founder@example.com',
    website: 'https://example.com',
    pitch_deck: 'https://example.com/deck.pdf',
    project_details: '<p>تفاصيل &amp; شرح</p><p>فقرة ثانية</p>',
    is_featured: '1',
    featured_order: '3',
    golden_partner_url: 'https://wdeny.com/offer/',
    views_count: '120',
    project_gallery: ['https://example.com/a.jpg', { url: 'https://example.com/b.jpg' }],
  },
  sector: [{ slug: 'logistics', name: 'لوجستيات' }],
  project_stage: 'نمو',
};

test('maps public fields and strips founder contact data', () => {
  const project = toPublicProject(rawItem);
  assert.ok(project);
  assert.equal(project.id, 42);
  assert.equal(project.title, 'منصة توصيل');
  assert.equal(project.number, 'PB-042');
  assert.equal(project.companyName, 'شركة النقل الذكي');
  assert.equal(project.isGolden, true);
  assert.equal(project.featuredOrder, 3);
  assert.equal(project.viewsCount, 120);
  assert.deepEqual(project.sector, { slug: 'logistics', name: 'لوجستيات' });
  assert.deepEqual(project.stage, { slug: 'growth', name: 'نمو وتوسع' });
  assert.deepEqual(project.gallery, ['https://example.com/a.jpg', 'https://example.com/b.jpg']);
  assert.equal(project.details, 'تفاصيل & شرح\nفقرة ثانية');

  const json = JSON.stringify(project);
  for (const field of PRIVATE_FIELDS) assert.equal(json.includes(field), false, `leaks ${field}`);
  for (const value of ['0558318777', 'founder@example.com', 'https://example.com"', 'deck.pdf']) {
    assert.equal(json.includes(value), false, `leaks ${value}`);
  }
});

test('rejects items without an id or title', () => {
  assert.equal(toPublicProject({ title: 'x' }), null);
  assert.equal(toPublicProject({ id: 1 }), null);
  assert.equal(toPublicProject('nope'), null);
});

test('extracts items from common feed envelopes', () => {
  assert.deepEqual(extractItems([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(extractItems({ projects: [{ id: 2 }] }), [{ id: 2 }]);
  assert.deepEqual(extractItems({ data: { items: [{ id: 3 }] } }), [{ id: 3 }]);
  assert.throws(() => extractItems({ nothing: true }));
});

test('normalizes Arabic variants for search', () => {
  assert.equal(normalizeForSearch('الشَّرِكَة'), 'الشركه');
  assert.equal(normalizeForSearch('أحمد إبراهيم آدم'), 'احمد ابراهيم ادم');
  assert.equal(normalizeForSearch('مستشفى'), 'مستشفي');
  assert.equal(normalizeForSearch('  Smart   Delivery! '), 'smart delivery');
});

test('converts html to text', () => {
  assert.equal(htmlToText('<ul><li>أ</li><li>ب</li></ul>'), '• أ\n• ب');
  assert.equal(htmlToText('a&nbsp;b &#1575; &#x628;'), 'a b ا ب');
});

test('maps the live feed shape (projects-directory-pro v38)', () => {
  const project = toPublicProject({
    id: 7324,
    number: 243,
    title: 'شركة المجتمع الافتراضي',
    title_en: 'VC',
    url: 'https://vibesholding.com/projects/vc/',
    image: 'https://vibesholding.com/wp-content/uploads/cover.webp',
    sector: 'تقنية المعلومات',
    project_stage: 'مرحلة تحقيق الدخل ( Cash Flow )',
    golden: true,
    partner_url: 'http://vcmem.com/offer',
    contact_rule: 'golden_direct',
    modified: '2026-09-02T09:50:44+00:00',
    meta: {
      project_number: '243',
      company_name: 'شركة المجتمع الافتراضي',
      founder_name: 'سالم',
      project_details: 'نص التفاصيل',
      excerpt: '',
      is_featured: '1',
      golden_partner_url: 'http://vcmem.com/offer',
      has_pitch_deck: '1',
      views_count: '436',
    },
  });
  assert.ok(project);
  assert.equal(project.number, '243');
  assert.equal(project.titleEn, 'VC');
  assert.equal(project.image, 'https://vibesholding.com/wp-content/uploads/cover.webp');
  assert.deepEqual(project.sector, { slug: 'تقنية-المعلومات', name: 'تقنية المعلومات' });
  assert.deepEqual(project.stage, { slug: 'revenue', name: 'تحقيق الدخل' });
  assert.equal(project.isGolden, true);
  assert.equal(project.goldenPartnerUrl, 'http://vcmem.com/offer');
  assert.equal(project.hasPitchDeck, true);
  assert.equal(project.contactRule, 'golden_direct');
  assert.equal(project.modifiedAt, '2026-09-02T09:50:44.000Z');
  assert.equal(project.excerpt, 'نص التفاصيل');
  assert.equal(project.viewsCount, 436);
  assert.equal(JSON.stringify(project).includes('/projects/vc/'), false, 'web page url must not be exposed');
});

test('treats an empty stage as no stage', () => {
  const project = toPublicProject({ id: 1, title: 'x', project_stage: '', sector: 'اخري' });
  assert.equal(project?.stage, null);
  assert.equal(project?.sector?.slug, 'اخري');
});

test('rule 4 covers the free text: contact data and a founder line typed inside the description never leave', () => {
  const project = toPublicProject({
    id: 9,
    title: 'x',
    excerpt: 'منصة توريد للمقاولين — للتواصل founder@example.test',
    meta: { project_details: 'منصة توريد رقمية للمقاولين.\nللتواصل واتساب 0552000001 أو founder@example.test\nالمؤسس: فلان الفلاني\nالعملاء: شركات المقاولات', project_details_en: 'A supply platform.\nFounder: John Doe\nVisit www.example.com or call +966 55 200 0001' },
  });
  const sent = JSON.stringify(project);
  for (const leak of ['0552000001', 'founder@example.test', 'فلان الفلاني', 'John Doe', 'www.example.com', '+966 55 200 0001']) assert.equal(sent.includes(leak), false, leak);
  assert.match(project?.details ?? '', /منصة توريد رقمية للمقاولين[\s\S]*العملاء: شركات المقاولات/);
  assert.match(project?.detailsEn ?? '', /A supply platform/);
});

test('the site\'s «اخري» is never shown as a stage: the adviser reads the step from the description, or the project has none', () => {
  const launched = toPublicProject({ id: 2, title: 'x', project_stage: 'اخري', meta: { project_details: 'وقد تم إطلاق المنتج والمرحلة الأولى من المنصة، وتضم حاليًا 8,210 شركات مسجلة، بينما تركز المرحلة القادمة على التوسع.' } });
  assert.deepEqual(launched?.stage, { slug: 'launch', name: 'إطلاق وتشغيل · تقدير المستشار', estimated: true });
  // A plan is not a fact, and marketing prose says nothing about where the project stands.
  const planned = toPublicProject({ id: 3, title: 'x', project_stage: 'أخرى', meta: { project_details: 'نخطط لإطلاق المنصة العام القادم ونسعى إلى التوسع في الخليج. منصة ذكية تربط العملاء بمقدمي الخدمات.' } });
  assert.equal(planned?.stage, null);
  for (const [site, slug] of [['مرحلة المنتج الأولي البذرة ( seed )', 'prototype'], ['مرحلة التوسع ( Expansion )', 'growth'], ['مرحلة الفكرة ما قبل البذرة ( Pre-seed )', 'idea'], ['مرحلة البداية', 'launch']] as const) {
    assert.deepEqual(toPublicProject({ id: 4, title: 'x', project_stage: site })?.stage?.slug, slug, site);
  }
});
