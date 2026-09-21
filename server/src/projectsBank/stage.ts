import { normalizeForSearch } from './text.js';
import type { StageTerm, Term } from './types.js';

/**
 * The club's five steps. The site's own stage places a project («مرحلة التوسع ( Expansion )» is growth); «اخري» on the
 * site is not a stage, so the adviser reads the step from what the description says already exists and the term is
 * marked `estimated`. A project it cannot read carries no stage at all: the app never shows «اخري» (owner, 2026-09-22).
 */
export const STAGES = [
  { key: 'idea', label: 'فكرة', match: /فكر|دراس|idea|concept/i },
  { key: 'prototype', label: 'تأسيس ونموذج أولي', match: /تاسيس|نموذج|اولي|تجريب|تطوير|prototype|mvp|(?<!pre )seed/i },
  { key: 'launch', label: 'إطلاق وتشغيل', match: /اطلاق|تشغيل|قايم|بدايه|launch|operat|early/i },
  { key: 'revenue', label: 'تحقيق الدخل', match: /دخل|ايراد|مبيعات|cash|revenue/i },
  { key: 'growth', label: 'نمو وتوسع', match: /نمو|توسع|انتشار|نضج|growth|scale|expan|mature/i },
] as const;
export const STEPS: string[] = STAGES.map((stage) => stage.label);
export type StageKey = (typeof STAGES)[number]['key'];

/** Marker of a stage the adviser read from the description, on cards and in the brief's table. */
export const ESTIMATED_MARK = 'تقدير المستشار';

/** 0-based step of a stage wording, -1 when it names none. The furthest matching step wins («تشغيل ونمو» is growth). */
export function stepOf(name: string | null | undefined): number {
  const folded = normalizeForSearch(name ?? '');
  let index = -1;
  if (folded) STAGES.forEach((stage, position) => (stage.match.test(folded) ? (index = position) : undefined));
  return index;
}

/** A sentence about tomorrow says nothing about where the project stands today. */
const PLANS = /نخطط|نسعي|نهدف|نطمح|نستهدف|نتطلع|نتوقع|متوقع|توقعات|سوف|سنقوم|سيتم|سنطلق|مستقبل|القادم|خطه|خطط|رويه|رويتنا|هدف|اهداف|يهدف|تهدف|يسعي|تسعي|نحتاج|بحاجه|aim|plan|will|goal|vision|future|expect|seek|need/;
/** What the text must say already exists, per step (folded spelling). */
const EVIDENCE: readonly RegExp[] = [
  /فكره|دراسه جدوي|قيد الدراسه|idea|concept|feasibility/,
  /نموذج اولي|النموذج الاولي|قيد التطوير|تحت التطوير|قيد الانشاء|تحت الانشاء|قيد التاسيس|تحت التاسيس|نسخه تجريبيه|مرحله تجريبيه|mvp|prototype|beta|under development/,
  /تم اطلاق|تم الاطلاق|اطلقنا|تم تشغيل|تم التشغيل|يعمل حاليا|تعمل حاليا|نعمل حاليا|قايم حاليا|شركه قايمه|مشروع قايم|تم افتتاح|افتتحنا|مستخدم مسجل|شركه مسجله|شركات مسجله|عميل مسجل|launched|operating|is live|registered users/,
  /حققنا|حققت ايرادات|حققت مبيعات|حقق ايرادات|حقق مبيعات|ايراداتنا|مبيعاتنا|ايرادات سنويه|ايرادات شهريه|مبيعات سنويه|مبيعات شهريه|عملاء يدفعون|دخل شهري|دخل سنوي|revenue of|in revenue|paying customers|annual sales/,
  /توسعنا|تم التوسع|افتتحنا فرع|فروعنا|عده فروع|اكثر من فرع|فرعا في|اسواق جديده دخلناها|expanded to|branches in/,
];

/** The step a description shows today, -1 when it does not say. The furthest step with evidence wins. */
export function estimateStep(details: string | null | undefined): number {
  let index = -1;
  // Clause by clause: «تم إطلاق المنتج، بينما تركز المرحلة القادمة على…» holds a fact and a plan in one sentence.
  for (const sentence of (details ?? '').split(/[.!?؟؛\n،]+|,(?!\d)|\sبينما\s/)) {
    const folded = normalizeForSearch(sentence);
    if (!folded || PLANS.test(folded)) continue;
    EVIDENCE.forEach((evidence, position) => (position > index && evidence.test(folded) ? (index = position) : undefined));
  }
  return index;
}

/** The stage a member sees: one of the five steps by the site's wording, else the adviser's reading, else none. */
export function placeStage(site: Term | null, details: string | null): StageTerm | null {
  const declared = stepOf(site?.name);
  const step = STAGES[declared >= 0 ? declared : estimateStep(details)];
  if (!step) return null;
  return declared >= 0 ? { slug: step.key, name: step.label } : { slug: step.key, name: `${step.label} · ${ESTIMATED_MARK}`, estimated: true };
}
