import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { RateLimiter } from '../auth/rateLimit.js';
import type { FetchImpl } from '../news/rss.js';
import type { KV } from '../store.js';
import { hasContact, stripContacts } from './redact.js';
import { makeExcerpt, normalizeForSearch } from './text.js';
import type { PublicProject } from './types.js';

/**
 * «ملخص المستشار» of a project (docs/BRIDGE_V2.md 4): an elegant table, the stage and the closest projects of the bank.
 * Built only from the public feed fields with contact data stripped (rule 4). The stage, the fact rows and the choice of
 * competitors are deterministic; with an OpenAI key the model only words the summary, the extra rows, the strengths, the
 * risks and the «why» of each competitor, and its answer is dropped when it breaks a rule (invented numbers, promised
 * returns, contact data). Cached in kv by content hash; without a key, or when the call fails, the rules write it.
 */
export type BriefRow = { label: string; value: string };
export type BriefStage = { key: string; label: string; index: number; total: number; steps: string[] };
export type BriefCompetitor = { id: number; title: string; sector: string | null; stage: string | null; why: string };
export type ProjectBrief = {
  summary: string;
  table: BriefRow[];
  stage: BriefStage;
  strengths: string[];
  risks: string[];
  competitors: BriefCompetitor[];
  disclaimer: string;
  generatedAt: string;
  source: 'ai' | 'rules';
};

/** The brief's disclaimer (docs/PROJECT_BRIEF.md, golden portal) after the «ملخص آلي» note of M13. */
export const BRIEF_DISCLAIMER = 'ملخص آلي من بيانات المشروع المنشورة في بنك المشاريع. المعلومات تعريفية وليست عرضًا تعاقديًا أو ضمانًا لعوائد.';
export const briefKey = (id: number): string => `projects:brief:${id}`;

const VERSION = 1;
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 25_000;
const RETRY_MS = 6 * 3_600_000;
const MAX_COMPETITORS = 4;
const AI_PER_HOUR = 90;

const STAGES = [
  { key: 'idea', label: 'فكرة', match: /فكر|دراس|idea|concept/i },
  { key: 'prototype', label: 'تأسيس ونموذج أولي', match: /تاسيس|نموذج|اولي|تجريب|تطوير|prototype|mvp|seed/i },
  { key: 'launch', label: 'إطلاق وتشغيل', match: /اطلاق|تشغيل|قايم|بدايه|launch|operat/i },
  { key: 'revenue', label: 'تحقيق الدخل', match: /دخل|ايراد|مبيعات|cash|revenue/i },
  { key: 'growth', label: 'نمو وتوسع', match: /نمو|توسع|انتشار|growth|scale|expan/i },
] as const;
const STEPS = STAGES.map((stage) => stage.label);

/** Wording rules of the app applied to text we author (CLAUDE.md): «بدون رسوم», and an en dash between two numbers. */
function fixWording(value: string): string {
  return value
    .replace(/مجان(?:ًا|اً|ا|ية|ي)?/g, 'بدون رسوم')
    .replace(/كريديت/g, 'رصيد')
    .replace(/([\d٠-٩%])\s*-\s*([\d٠-٩])/g, '$1–$2')
    .replace(/\s+/g, ' ')
    .trim();
}
const PROMISE = /مضمون|نضمن|يضمن|ضمان (?:ال)?(?:عائد|ربح|أرباح)|بلا مخاطر|بدون مخاطر|guarantee|risk[- ]free/i;
const RETURNS = /عائد|عوائد|أرباح|ارباح|ربح|roi|return|profit/i;
/** Forward-looking yield talk: never in the prose, whatever the founder wrote. */
const YIELD = /عائد|عوائد|roi|return on/i;
const CONTACT_LABEL = /واتس|جوال|هاتف|تواصل|بريد|ايميل|إيميل|موقع|رابط|email|phone|whats|website|انستقرام|تويتر|سناب/i;

/** The founder's text as the brief may use it: no contact data, and no line that talks yields or guarantees. */
function publicProse(details: string | null): string {
  return (details ?? '')
    .split('\n')
    .filter((row) => !hasContact(row) && !YIELD.test(row) && !PROMISE.test(row) && !/للتواصل|تواصل معنا|واتس/.test(row))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stageOf(project: Pick<PublicProject, 'stage'>): BriefStage {
  const name = project.stage?.name ?? '';
  const folded = normalizeForSearch(name);
  // The furthest matching step wins («تشغيل ونمو» is growth).
  let index = -1;
  STAGES.forEach((stage, position) => {
    if (folded && stage.match.test(folded)) index = position;
  });
  const hit = index >= 0 ? STAGES[index] : undefined;
  return { key: hit?.key ?? 'unknown', label: name || 'غير محددة', index, total: STAGES.length, steps: STEPS };
}

const STOP = new Set(['من', 'في', 'على', 'الى', 'عن', 'مع', 'هذا', 'هذه', 'التي', 'الذي', 'او', 'ان', 'كل', 'بين', 'حيث', 'كما', 'ذلك', 'مشروع', 'المشروع', 'شركه', 'الشركه', 'the', 'and', 'for', 'with']);
function tokens(project: PublicProject): Set<string> {
  const text = normalizeForSearch([project.title, project.excerpt, project.details].filter(Boolean).join(' '));
  return new Set(text.split(' ').filter((word) => word.length >= 3 && !STOP.has(word)));
}

type Ranked = { project: PublicProject; sameSector: boolean; gap: number | null; overlap: number };

/** Same sector first, then the closest stage, then shared wording. No model is asked. */
export function pickCompetitors(project: PublicProject, all: PublicProject[], max = MAX_COMPETITORS): Ranked[] {
  const own = tokens(project);
  const ownStage = stageOf(project).index;
  const ranked = all
    .filter((other) => other.id !== project.id)
    .map((other) => {
      const theirs = tokens(other);
      const shared = [...own].filter((word) => theirs.has(word)).length;
      // Share of the shorter description: a one-line project can still be close to a long one. One common word is chance.
      const smaller = Math.min(own.size, theirs.size);
      const stage = stageOf(other).index;
      return {
        project: other,
        sameSector: Boolean(project.sector && other.sector?.slug === project.sector.slug),
        gap: ownStage >= 0 && stage >= 0 ? Math.abs(ownStage - stage) : null,
        overlap: shared >= 2 && smaller ? shared / smaller : 0,
      };
    })
    .filter((row) => row.sameSector || row.overlap >= 0.25);
  const score = (row: Ranked): number => (row.sameSector ? 100 : 0) + (row.gap === null ? 0 : 20 - row.gap * 5) + row.overlap * 50;
  return ranked.sort((a, b) => score(b) - score(a) || a.project.id - b.project.id).slice(0, max);
}

function ruleWhy(row: Ranked): string {
  const parts: string[] = [];
  if (row.sameSector && row.project.sector) parts.push(`يعمل في القطاع نفسه (${row.project.sector.name})`);
  if (row.gap === 0) parts.push('في المرحلة نفسها');
  else if (row.gap === 1) parts.push('في مرحلة قريبة');
  if (!row.sameSector || row.overlap >= 0.4) parts.push('يتقاطع وصفه مع وصف هذا المشروع');
  return `${parts.join(' و')}.`;
}

/** Digit runs of a text (Arabic-Indic folded, separators dropped): what the model may quote, nothing else. */
function numbersOf(value: string): Set<string> {
  const western = value.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  return new Set((western.match(/\d[\d,٬.]*\d|\d/g) ?? []).map((run) => run.replace(/[,٬.]/g, '')).filter((run) => run.length >= 2));
}

const dayFormat = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'long', timeZone: 'Asia/Riyadh' });

function factRows(project: PublicProject): BriefRow[] {
  const rows: [string, string | null][] = [
    ['رقم المشروع', project.number],
    ['الشركة', project.companyName],
    ['المؤسس', project.founderName],
    ['القطاع', project.sector?.name ?? null],
    ['المرحلة', project.stage?.name ?? null],
    ['النوع', project.isGolden ? 'مشروع ذهبي (علامة V)' : 'مشروع في بنك المشاريع'],
    ['ملف العرض', project.hasPitchDeck && !project.isGolden ? 'متاح للأعضاء بعد فتح المشروع' : 'غير مرفق'],
    ['آخر تحديث', project.modifiedAt ? dayFormat.format(new Date(project.modifiedAt)) : null],
  ];
  return rows.filter((row): row is [string, string] => Boolean(row[1])).map(([label, value]) => ({ label, value: fixWording(stripContacts(value)) })).filter((row) => row.value);
}

/** «label: value» lines the founder wrote, minus anything about returns or contact. */
function writtenRows(details: string, taken: Set<string>): BriefRow[] {
  const rows: BriefRow[] = [];
  for (const line of details.split('\n')) {
    const match = /^[\s•\-–*]*([^:：\n]{2,40})[:：]\s*(.{2,160})$/.exec(line.trim());
    if (!match) continue;
    const label = fixWording(match[1] ?? '');
    const value = fixWording(match[2] ?? '');
    if (!label || !value || taken.has(label) || RETURNS.test(label + value) || PROMISE.test(value) || CONTACT_LABEL.test(label)) continue;
    taken.add(label);
    rows.push({ label, value });
    if (rows.length >= 6) break;
  }
  return rows;
}

function rulesBrief(project: PublicProject, details: string, picks: Ranked[], now: number): ProjectBrief {
  const stage = stageOf(project);
  const facts = factRows(project);
  const summary = fixWording(publicProse(project.excerpt) || makeExcerpt(details, 320)) || `${project.title}${project.sector ? `: مشروع في قطاع ${project.sector.name}` : ''}.`;
  const strengths = [
    details.length >= 400 ? 'وصف تفصيلي يشرح فكرة المشروع ونموذج عمله' : null,
    project.hasPitchDeck && !project.isGolden ? 'ملف عرض (Pitch Deck) متاح للأعضاء بعد فتح المشروع' : null,
    project.isGolden ? 'مشروع ذهبي يحمل علامة V من شركات المنظومة' : null,
    project.companyName && project.founderName ? 'الشركة والمؤسس معلنان بالاسم' : null,
    stage.index >= 3 ? 'تجاوز مرحلة الإطلاق بحسب بيانات صاحبه' : null,
  ].filter((line): line is string => line !== null);
  const risks = [
    'المعلومات مقدمة من صاحب المشروع ولم تُراجَع بشكل مستقل',
    stage.index < 0 ? 'مرحلة المشروع غير محددة في بياناته' : stage.index <= 1 ? 'المشروع في مرحلة مبكرة ولم يثبت نموذجه في السوق بعد' : null,
    details.length < 200 ? 'الوصف المنشور مختصر؛ اطلب تفاصيل أوفى قبل أي قرار' : null,
    picks.filter((row) => row.sameSector).length >= 3 ? 'أكثر من مشروع مشابه في القطاع نفسه داخل بنك المشاريع' : null,
    project.hasPitchDeck ? null : 'لا يوجد ملف عرض مرفق',
  ].filter((line): line is string => line !== null);
  return {
    summary,
    table: [...facts, ...writtenRows(details, new Set(facts.map((row) => row.label)))],
    stage,
    strengths: strengths.length ? strengths : ['بياناته منشورة في بنك المشاريع ويمكن سؤال المستشار عن تفاصيلها'],
    risks,
    competitors: picks.map((row) => ({ id: row.project.id, title: row.project.title, sector: row.project.sector?.name ?? null, stage: row.project.stage?.name ?? null, why: ruleWhy(row) })),
    disclaimer: BRIEF_DISCLAIMER,
    generatedAt: new Date(now).toISOString(),
    source: 'rules',
  };
}

const SYSTEM_PROMPT = [
  'You are «المستشار», the adviser of نادي المستثمرين (a Saudi business club). You turn ONE project of the club\'s Projects Bank into a short brief for a member.',
  'Use ONLY the project data you are given. Never invent a number, a name, a market size, a customer or a date; quote numbers exactly as written or leave them out.',
  'Never promise or estimate returns or profits, never call anything guaranteed or safe, never advise to invest. No contact data of any kind (phones, e-mails, links, handles).',
  'Write Modern Standard Arabic, polished and concise, no emojis, no exclamation marks.',
  'Vocabulary: «بدون رسوم» never «مجاني»; «رصيد» never «كريديت»; «الشراكات» never «الصفقات» (company names stay as written). Numeric ranges in words (من … إلى …), never a hyphen between two numbers.',
  'Return: summary (2 to 4 sentences: what it is, for whom, how it earns, where it stands); table (up to 8 rows «label, value» with the facts a partner asks about first, taken from the text: product, customers, revenue model, what is requested, location, team… skip a row when the text does not say); strengths (up to 4); risks (up to 4, honest and specific to what the text says or leaves out); competitors: for EVERY competitor id you were given, one sentence «why» it is comparable, from the two descriptions only.',
].join('\n');

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'project_brief',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        table: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'], additionalProperties: false } },
        strengths: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        competitors: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, why: { type: 'string' } }, required: ['id', 'why'], additionalProperties: false } },
      },
      required: ['summary', 'table', 'strengths', 'risks', 'competitors'],
      additionalProperties: false,
    },
  },
};

const line = z.string().trim().min(5).max(260);
const answerSchema = z
  .object({
    summary: z.string().trim().min(40).max(900),
    table: z.array(z.object({ label: z.string().trim().min(2).max(40), value: z.string().trim().min(1).max(220) }).strict()).max(12),
    strengths: z.array(line).max(6),
    risks: z.array(line).max(6),
    competitors: z.array(z.object({ id: z.number().int(), why: line }).strict()).max(8),
  })
  .strict();

type Stored = { hash: string; brief: ProjectBrief; retryAt?: number };
type Deps = { kv: KV; log: FastifyBaseLogger; apiKey?: string; model: string; fetchImpl?: FetchImpl };

export class BriefService {
  private readonly inflight = new Map<number, Promise<ProjectBrief>>();
  private readonly limiter = new RateLimiter();

  constructor(private readonly deps: Deps) {}

  get mode(): 'openai' | 'rules' {
    return this.deps.apiKey ? 'openai' : 'rules';
  }

  brief(project: PublicProject, all: PublicProject[], now = Date.now()): Promise<ProjectBrief> {
    const running = this.inflight.get(project.id);
    if (running) return running;
    const run = this.build(project, all, now).finally(() => this.inflight.delete(project.id));
    this.inflight.set(project.id, run);
    return run;
  }

  private async build(project: PublicProject, all: PublicProject[], now: number): Promise<ProjectBrief> {
    const details = publicProse(project.details);
    const picks = pickCompetitors(project, all);
    const content = [VERSION, this.mode, project.number, project.title, project.companyName, project.founderName, project.sector?.name, project.stage?.name, project.excerpt, details, project.isGolden, project.hasPitchDeck, picks.map((row) => [row.project.id, row.project.title])];
    const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    const stored = await this.deps.kv.get<Stored>(briefKey(project.id));
    if (stored?.hash === hash && (stored.brief.source === 'ai' || this.mode === 'rules' || now < (stored.retryAt ?? 0))) return stored.brief;

    const rules = rulesBrief(project, details, picks, now);
    let brief = rules;
    if (this.deps.apiKey && this.limiter.hit('brief', AI_PER_HOUR, 3_600_000)) {
      try {
        brief = await this.worded(project, details, picks, rules);
      } catch (error) {
        this.deps.log.warn({ project: project.id, reason: error instanceof Error ? error.message : 'unknown' }, 'AI project brief failed, the rules wrote it');
      }
    }
    // A failed call is tried again later; the rules' answer serves meanwhile.
    await this.deps.kv.set(briefKey(project.id), { hash, brief, ...(brief.source === 'rules' && this.mode === 'openai' ? { retryAt: now + RETRY_MS } : {}) } satisfies Stored);
    return brief;
  }

  private async worded(project: PublicProject, details: string, picks: Ranked[], rules: ProjectBrief): Promise<ProjectBrief> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const payload = {
      project: { title: project.title, company: project.companyName, sector: project.sector?.name ?? null, stage: project.stage?.name ?? null, golden: project.isGolden, description: details.slice(0, 5000) },
      competitors: picks.map((row) => ({ id: row.project.id, title: row.project.title, sector: row.project.sector?.name ?? null, stage: row.project.stage?.name ?? null, description: publicProse(row.project.excerpt ?? makeExcerpt(row.project.details ?? '', 300)).slice(0, 400) })),
    };
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.deps.model,
        temperature: 0.3,
        response_format: RESPONSE_FORMAT,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: unknown };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('OpenAI answer has no content');
    const answer = answerSchema.parse(JSON.parse(content));

    const allowed = numbersOf(JSON.stringify(payload));
    const sound = (value: string): boolean => !PROMISE.test(value) && !hasContact(value) && [...numbersOf(value)].every((run) => allowed.has(run));
    const summary = fixWording(answer.summary);
    if (!sound(summary) || YIELD.test(summary)) throw new Error('the summary breaks a wording rule');
    const facts = factRows(project);
    const taken = new Set(facts.map((row) => row.label));
    const extra = answer.table
      .map((row) => ({ label: fixWording(row.label), value: fixWording(row.value) }))
      .filter((row) => sound(row.value) && sound(row.label) && !RETURNS.test(row.label + row.value) && !CONTACT_LABEL.test(row.label) && !taken.has(row.label))
      .slice(0, 8);
    const lines = (items: string[], fallback: string[]): string[] => {
      const kept = items.map(fixWording).filter((item) => sound(item) && !YIELD.test(item)).slice(0, 4);
      return kept.length ? kept : fallback;
    };
    const whys = new Map(answer.competitors.map((row) => [row.id, fixWording(row.why)]));
    this.deps.log.info({ project: project.id, usage: body.usage }, 'project brief worded by OpenAI');
    return {
      ...rules,
      summary,
      // The fact rows stay ours; the model's rows replace the «label: value» lines lifted from the text.
      table: [...facts, ...extra],
      strengths: lines(answer.strengths, rules.strengths),
      risks: lines(answer.risks, rules.risks),
      competitors: rules.competitors.map((row) => {
        const why = whys.get(row.id);
        return why && sound(why) && !YIELD.test(why) ? { ...row, why } : row;
      }),
      source: 'ai',
    };
  }
}
