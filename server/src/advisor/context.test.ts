import assert from 'node:assert/strict';
import { test } from 'node:test';

import { briefKey, type ProjectBrief } from '../projectsBank/brief.js';
import type { PublicProject } from '../projectsBank/types.js';
import { MemoryKV } from '../store.js';
import { CONTEXT_TEXT_MAX, ContextResolver } from './context.js';

/** M27 stage 3: the English app asks the hub's brain for English without a plugin change. */
test('the English app asks for English through the page title and the focus, never through a fabricated focus', async () => {
  // A null context and the plain screens read no dependency.
  const resolver = new ContextResolver({} as never);

  const none = await resolver.resolve(null, 'en');
  assert.match(none.title, /^تطبيق نادي المستثمرين \(English: reply in English\)$/);
  assert.equal(none.focus, null, 'a focus would route every English message to the deep model');
  assert.equal((await resolver.resolve(null)).title, '', 'Arabic sends what it always sent');

  const home = await resolver.resolve({ type: 'screen', id: 'home' }, 'en');
  assert.ok(home.title.startsWith('تطبيق نادي المستثمرين (English: reply in English) — الشاشة الرئيسية'), home.title);
  assert.ok(home.title.indexOf('reply in English') < 90, 'the brain shows the first 90 characters of the title');
  assert.match(home.focus?.text ?? '', /^العضو يستخدم النسخة الإنجليزية من التطبيق: أجب بالإنجليزية\. \(The member uses the English version of the app: reply in English\.\)\n/);

  const arabic = await resolver.resolve({ type: 'screen', id: 'home' }, 'ar');
  assert.equal(arabic.title, 'الشاشة الرئيسية — تطبيق نادي المستثمرين');
  assert.ok(!arabic.focus?.text.includes('English'));
});

/** M201: the advisor button on every project — the context is built here, from what the project's screen shows. */
test('a project context carries the stored brief and the stars, with contact data stripped and the brief ahead of a long description', async () => {
  const kv = new MemoryKV();
  const project = {
    id: 7,
    number: '70',
    title: 'تطبيق توصيل',
    companyName: 'شركة التوصيل',
    sector: { name: 'الخدمات اللوجستية' },
    stage: { name: 'أخرى' },
    isGolden: false,
    excerpt: 'منصة توصيل للمطاعم.',
    details: `نوصل الطلبات داخل الرياض. للتواصل founder@delivery-app.com أو 0551234567.\n${'تفاصيل التشغيل اليومية. '.repeat(600)}`,
  } as unknown as PublicProject;
  const projects = { get: (id: number) => (id === 7 ? project : null), pageUrl: () => 'https://vibesholding.com/project/delivery/' };
  const brief: ProjectBrief = {
    summary: 'منصة توصيل تخدم المطاعم داخل الرياض.',
    table: [{ label: 'الشركة', value: 'شركة التوصيل' }],
    stage: { key: 'launch', label: 'الإطلاق', index: 2, total: 5, steps: [], estimated: true },
    strengths: ['وصف تفصيلي يشرح نموذج العمل'],
    risks: ['سوق مزدحم؛ راسل المؤسس على واتساب 0559876543'],
    competitors: [{ id: 9, title: 'مشروع شحن سريع', sector: 'الخدمات اللوجستية', stage: null, why: 'القطاع نفسه' }],
    disclaimer: '',
    generatedAt: '2026-11-05T00:00:00.000Z',
    source: 'rules',
  };
  await kv.set(briefKey(7), { hash: 'h', brief });
  const resolver = new ContextResolver({ projects, kv, ratingOf: (id: number) => (id === 7 ? { stars: 4.5, count: 3 } : { stars: null, count: 0 }) } as never);

  const found = await resolver.resolve({ type: 'project', id: 7 });
  const text = found.focus?.text ?? '';
  assert.equal(found.focus?.type, 'project');
  assert.equal(found.focus?.id, '7');
  assert.equal(found.title, 'تطبيق توصيل (مشروع رقم 70)');
  for (const expected of ['تقييم الأعضاء: 4.5 من 5 (عدد التقييمات: 3)', 'منصة توصيل تخدم المطاعم داخل الرياض.', '• الشركة: شركة التوصيل', 'المرحلة بتقدير المستشار من وصف المشروع: الإطلاق', '• وصف تفصيلي يشرح نموذج العمل', '• مشروع شحن سريع (الخدمات اللوجستية): القطاع نفسه', 'نوصل الطلبات داخل الرياض.']) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  // Rule 4: nothing that reaches the founder, wherever it was written.
  for (const leaked of ['founder@', 'delivery-app.com', '0551234567', '0559876543']) assert.ok(!text.includes(leaked), `leaked: ${leaked}`);
  assert.ok(text.length <= CONTEXT_TEXT_MAX);
  assert.ok(text.indexOf('ملخص المستشار المعروض') < text.indexOf('الوصف:'), 'the cut takes the description tail, not the brief');

  // The English app: the same facts behind the language note.
  const english = await resolver.resolve({ type: 'project', id: 7 }, 'en');
  assert.ok(english.focus?.text.startsWith('العضو يستخدم النسخة الإنجليزية'));
  assert.ok(english.focus?.text.includes('• مشروع شحن سريع'));

  // No stored brief and no rating: the public fields alone, as before. An unknown project has no context at all.
  const bare = new ContextResolver({ projects, kv: new MemoryKV() } as never);
  const plain = (await bare.resolve({ type: 'project', id: 7 })).focus?.text ?? '';
  assert.ok(plain.includes('القطاع: الخدمات اللوجستية') && !plain.includes('ملخص المستشار') && !plain.includes('تقييم الأعضاء'));
  assert.equal((await resolver.resolve({ type: 'project', id: 8 })).focus, null);

  // A stored value of another shape costs the brief's lines only.
  const odd = new MemoryKV();
  await odd.set(briefKey(7), { hash: 'h', brief: { summary: 5 } });
  assert.ok(((await new ContextResolver({ projects, kv: odd } as never).resolve({ type: 'project', id: 7 })).focus?.text ?? '').includes('نبذة: منصة توصيل للمطاعم.'));
});
