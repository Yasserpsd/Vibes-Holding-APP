import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { RateLimiter } from '../auth/rateLimit.js';
import type { AppLang } from '../lang.js';
import type { FetchImpl } from '../news/rss.js';
import type { KV } from '../store.js';
import { STAGE_EN, localizeProject } from './lang.js';
import { hasContact, mentionsFunding, stripContacts, stripFunding } from './redact.js';
import { STAGES, STEPS, stepOf } from './stage.js';
import { makeExcerpt, normalizeForSearch } from './text.js';
import type { PublicProject } from './types.js';

/**
 * «ملخص المستشار» of a project (docs/BRIDGE_V2.md 4): an elegant table, the stage and the closest projects of the bank.
 * Built only from the public feed fields with contact data stripped (rule 4). The stage, the fact rows and the choice of
 * competitors are deterministic; with an OpenAI key the model only words the summary, the extra rows, the strengths, the
 * risks and the «why» of each competitor, and its answer is dropped when it breaks a rule (invented numbers, promised
 * returns, contact data). Cached in kv by content hash; without a key, or when the call fails, the rules write it.
 * The English app (M27) gets its brief in English: the same choices, the founder's English text where he wrote one,
 * the rules' sentences and the model's wording in English, cached apart from the Arabic brief.
 */
export type BriefRow = { label: string; value: string };
/** `estimated`: the site's own wording does not place the project («أخرى», empty), so the step is the adviser's reading of the description. */
export type BriefStage = { key: string; label: string; index: number; total: number; steps: string[]; estimated: boolean };
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
export const BRIEF_DISCLAIMER_EN = "An automatic summary from the project's published data in the Projects Bank. This information is descriptive and is neither a contractual offer nor a guarantee of returns.";
/** The Arabic brief keeps its key of M13; the English one sits beside it. */
export const briefKey = (id: number, lang: AppLang = 'ar'): string => (lang === 'en' ? `projects:brief:${id}:en` : `projects:brief:${id}`);

const VERSION = 4;
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 25_000;
const RETRY_MS = 6 * 3_600_000;
const MAX_COMPETITORS = 4;
const AI_PER_HOUR = 90;

/** Every sentence the rules write, per language; the model gets the matching language line of its prompt. */
type BriefText = {
  unknownStage: string;
  disclaimer: string;
  labels: { number: string; company: string; sector: string; stage: string; kind: string; deck: string; updated: string };
  kind: { golden: string; bank: string };
  deck: { members: string; none: string };
  summaryFallback: (title: string, sector: string | null) => string;
  strengths: { detailed: string; deck: string; golden: string; pastLaunch: string; fallback: string };
  risks: { unreviewed: string; noStage: string; early: string; short: string; crowded: string; noDeck: string };
  why: { sameSector: (sector: string) => string; sameStage: string; nearStage: string; overlap: string; join: string };
  dateLocale: string;
  language: string[];
};

const TEXT: Record<AppLang, BriefText> = {
  ar: {
    unknownStage: 'غير محددة',
    disclaimer: BRIEF_DISCLAIMER,
    labels: { number: 'رقم المشروع', company: 'الشركة', sector: 'القطاع', stage: 'المرحلة', kind: 'النوع', deck: 'ملف العرض', updated: 'آخر تحديث' },
    kind: { golden: 'مشروع ذهبي (علامة V)', bank: 'مشروع في بنك المشاريع' },
    deck: { members: 'متاح للأعضاء بعد فتح المشروع', none: 'غير مرفق' },
    summaryFallback: (title, sector) => `${title}${sector ? `: مشروع في قطاع ${sector}` : ''}.`,
    strengths: {
      detailed: 'وصف تفصيلي يشرح فكرة المشروع ونموذج عمله',
      deck: 'ملف عرض (Pitch Deck) متاح للأعضاء بعد فتح المشروع',
      golden: 'مشروع ذهبي يحمل علامة V من شركات المنظومة',
      pastLaunch: 'تجاوز مرحلة الإطلاق بحسب بيانات صاحبه',
      fallback: 'بياناته منشورة في بنك المشاريع ويمكن سؤال المستشار عن تفاصيلها',
    },
    risks: {
      unreviewed: 'المعلومات مقدمة من صاحب المشروع ولم تُراجَع بشكل مستقل',
      noStage: 'مرحلة المشروع غير محددة في بياناته',
      early: 'المشروع في مرحلة مبكرة ولم يثبت نموذجه في السوق بعد',
      short: 'الوصف المنشور مختصر؛ اطلب تفاصيل أوفى قبل أي قرار',
      crowded: 'أكثر من مشروع مشابه في القطاع نفسه داخل بنك المشاريع',
      noDeck: 'لا يوجد ملف عرض مرفق',
    },
    why: { sameSector: (sector) => `يعمل في القطاع نفسه (${sector})`, sameStage: 'في المرحلة نفسها', nearStage: 'في مرحلة قريبة', overlap: 'يتقاطع وصفه مع وصف هذا المشروع', join: ' و' },
    dateLocale: 'ar-SA-u-ca-gregory-nu-latn',
    language: [
      'Write Modern Standard Arabic, polished and concise, no emojis, no exclamation marks.',
      'Vocabulary: «بدون رسوم» never «مجاني»; «رصيد» never «كريديت»; «الشراكات» never «الصفقات» (company names stay as written). Numeric ranges in words (من … إلى …), never a hyphen between two numbers.',
    ],
  },
  en: {
    unknownStage: 'Not specified',
    disclaimer: BRIEF_DISCLAIMER_EN,
    labels: { number: 'Project number', company: 'Company', sector: 'Sector', stage: 'Stage', kind: 'Type', deck: 'Pitch deck', updated: 'Last update' },
    kind: { golden: 'Golden project (V mark)', bank: 'Project in the Projects Bank' },
    deck: { members: 'Available to members after unlocking the project', none: 'Not attached' },
    summaryFallback: (title, sector) => `${title}${sector ? `: a project in the ${sector} sector` : ''}.`,
    strengths: {
      detailed: 'A detailed description explains the project idea and its business model',
      deck: 'A pitch deck is available to members once the project is unlocked',
      golden: "A golden project carrying the V mark of the group's companies",
      pastLaunch: "Past the launch stage according to its owner's data",
      fallback: 'Its data is published in the Projects Bank and the adviser can be asked about the details',
    },
    risks: {
      unreviewed: 'The information is provided by the project owner and has not been independently reviewed',
      noStage: 'The project stage is not stated in its data',
      early: 'The project is at an early stage and its model is not yet proven in the market',
      short: 'The published description is brief; ask for fuller details before any decision',
      crowded: 'More than one similar project in the same sector inside the Projects Bank',
      noDeck: 'No pitch deck attached',
    },
    why: { sameSector: (sector) => `works in the same sector (${sector})`, sameStage: 'is at the same stage', nearStage: 'is at a nearby stage', overlap: "its description overlaps with this project's", join: ' and ' },
    dateLocale: 'en-GB',
    language: [
      'Write polished, concise English, no emojis, no exclamation marks. Write the table labels in English too.',
      'Vocabulary: "at no charge" never "free"; "balance" never "credit"; "partnerships" never "deals" (company names stay as written). Numeric ranges in words (from … to …), never a hyphen between two numbers.',
    ],
  },
};

/** Wording rules of the app applied to text we author (CLAUDE.md): «بدون رسوم», and an en dash between two numbers. */
function fixWording(value: string, lang: AppLang = 'ar'): string {
  const text =
    lang === 'en'
      ? value.replace(/\bfree\b/gi, 'at no charge')
      : value.replace(/مجان(?:ًا|اً|ا|ية|ي)?/g, 'بدون رسوم').replace(/كريديت/g, 'رصيد');
  return text
    .replace(/([\d٠-٩%])\s*-\s*([\d٠-٩])/g, '$1–$2')
    .replace(/\s+/g, ' ')
    .trim();
}
const PROMISE = /مضمون|نضمن|يضمن|ضمان (?:ال)?(?:عائد|ربح|أرباح)|بلا مخاطر|بدون مخاطر|guarantee|risk[- ]free/i;
const RETURNS = /عائد|عوائد|أرباح|ارباح|ربح|roi|return|profit/i;
/** Forward-looking yield talk: never in the prose, whatever the founder wrote. */
const YIELD = /عائد|عوائد|roi|return on/i;
const CONTACT_LABEL = /واتس|جوال|هاتف|تواصل|بريد|ايميل|إيميل|موقع|رابط|email|phone|whats|website|انستقرام|تويتر|سناب/i;
/** Rows about what the project asks for or who founded it: the app shows what the project is (owner's rule). */
const ASK_LABEL = /المطلوب|الاحتياج|التمويل|الاستثمار|رأس\s*المال|راس\s*المال|الحص[ةه]|التقييم|المؤسس|المالك|funding|investment|valuation|equity|founder|the ask/i;

/** The founder's text as the brief may use it: no contact data, and no line that talks yields or guarantees. */
function publicProse(details: string | null): string {
  // The mapper strips the funding ask already; here as well, for a snapshot stored before that rule.
  return stripFunding(details ?? '')
    .split('\n')
    .filter((row) => !hasContact(row) && !YIELD.test(row) && !PROMISE.test(row) && !/للتواصل|تواصل معنا|واتس/.test(row))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const stepsOf = (lang: AppLang): string[] => (lang === 'en' ? STAGES.map((stage) => STAGE_EN[stage.key]) : STEPS);

export function stageOf(project: Pick<PublicProject, 'stage'>, lang: AppLang = 'ar'): BriefStage {
  // The mapper already placed the project on the five steps (`placeStage`); a snapshot stored before that still carries the site's wording.
  const bySlug = STAGES.findIndex((stage) => stage.key === project.stage?.slug);
  const index = bySlug >= 0 ? bySlug : stepOf(project.stage?.name);
  const hit = STAGES[index];
  const label = hit ? (lang === 'en' ? STAGE_EN[hit.key] : hit.label) : TEXT[lang].unknownStage;
  return { key: hit?.key ?? 'unknown', label, index, total: STAGES.length, steps: stepsOf(lang), estimated: Boolean(hit && project.stage?.estimated) };
}

const STOP = new Set(['من', 'في', 'على', 'الى', 'عن', 'مع', 'هذا', 'هذه', 'التي', 'الذي', 'او', 'ان', 'كل', 'بين', 'حيث', 'كما', 'ذلك', 'مشروع', 'المشروع', 'شركه', 'الشركه', 'the', 'and', 'for', 'with']);
function tokens(project: PublicProject): Set<string> {
  const text = normalizeForSearch([project.title, project.excerpt, project.details].filter(Boolean).join(' '));
  return new Set(text.split(' ').filter((word) => word.length >= 3 && !STOP.has(word)));
}

type Ranked = { project: PublicProject; sameSector: boolean; gap: number | null; overlap: number };

/** Same sector first, then the closest stage, then shared wording. No model is asked. Always on the Arabic data, so both languages name the same projects. */
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

function ruleWhy(row: Ranked, lang: AppLang): string {
  const text = TEXT[lang];
  const shown = localizeProject(row.project, lang);
  const parts: string[] = [];
  if (row.sameSector && shown.sector) parts.push(text.why.sameSector(shown.sector.name));
  if (row.gap === 0) parts.push(text.why.sameStage);
  else if (row.gap === 1) parts.push(text.why.nearStage);
  if (!row.sameSector || row.overlap >= 0.4) parts.push(text.why.overlap);
  const sentence = `${parts.join(text.why.join)}.`;
  return lang === 'en' ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : sentence;
}

/** Digit runs of a text (Arabic-Indic folded, separators dropped): what the model may quote, nothing else. */
function numbersOf(value: string): Set<string> {
  const western = value.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  return new Set((western.match(/\d[\d,٬.]*\d|\d/g) ?? []).map((run) => run.replace(/[,٬.]/g, '')).filter((run) => run.length >= 2));
}

const dayFormats: Partial<Record<AppLang, Intl.DateTimeFormat>> = {};
const dayFormat = (lang: AppLang): Intl.DateTimeFormat => (dayFormats[lang] ??= new Intl.DateTimeFormat(TEXT[lang].dateLocale, { dateStyle: 'long', timeZone: 'Asia/Riyadh' }));

function factRows(project: PublicProject, lang: AppLang): BriefRow[] {
  const text = TEXT[lang];
  const rows: [string, string | null][] = [
    [text.labels.number, project.number],
    [text.labels.company, project.companyName],
    [text.labels.sector, project.sector?.name ?? null],
    [text.labels.stage, project.stage?.name ?? null],
    [text.labels.kind, project.isGolden ? text.kind.golden : text.kind.bank],
    [text.labels.deck, project.hasPitchDeck && !project.isGolden ? text.deck.members : text.deck.none],
    [text.labels.updated, project.modifiedAt ? dayFormat(lang).format(new Date(project.modifiedAt)) : null],
  ];
  return rows.filter((row): row is [string, string] => Boolean(row[1])).map(([label, value]) => ({ label, value: fixWording(stripContacts(value), lang) })).filter((row) => row.value);
}

/** «label: value» lines the founder wrote, minus anything about returns or contact. */
function writtenRows(details: string, taken: Set<string>, lang: AppLang): BriefRow[] {
  const rows: BriefRow[] = [];
  for (const line of details.split('\n')) {
    const match = /^[\s•\-–*]*([^:：\n]{2,40})[:：]\s*(.{2,160})$/.exec(line.trim());
    if (!match) continue;
    const label = fixWording(match[1] ?? '', lang);
    const value = fixWording(match[2] ?? '', lang);
    if (!label || !value || taken.has(label) || RETURNS.test(label + value) || PROMISE.test(value) || CONTACT_LABEL.test(label) || ASK_LABEL.test(label) || mentionsFunding(value)) continue;
    taken.add(label);
    rows.push({ label, value });
    if (rows.length >= 6) break;
  }
  return rows;
}

/** `project` is already in the brief's language (`localizeProject`); `picks` were chosen on the Arabic data. */
function rulesBrief(project: PublicProject, details: string, picks: Ranked[], now: number, lang: AppLang): ProjectBrief {
  const text = TEXT[lang];
  const stage = stageOf(project, lang);
  const facts = factRows(project, lang);
  const summary = fixWording(publicProse(project.excerpt) || makeExcerpt(details, 320), lang) || text.summaryFallback(project.title, project.sector?.name ?? null);
  const strengths = [
    details.length >= 400 ? text.strengths.detailed : null,
    project.hasPitchDeck && !project.isGolden ? text.strengths.deck : null,
    project.isGolden ? text.strengths.golden : null,
    stage.index >= 3 ? text.strengths.pastLaunch : null,
  ].filter((line): line is string => line !== null);
  const risks = [
    text.risks.unreviewed,
    stage.index < 0 ? text.risks.noStage : stage.index <= 1 ? text.risks.early : null,
    details.length < 200 ? text.risks.short : null,
    picks.filter((row) => row.sameSector).length >= 3 ? text.risks.crowded : null,
    project.hasPitchDeck ? null : text.risks.noDeck,
  ].filter((line): line is string => line !== null);
  return {
    summary,
    table: [...facts, ...writtenRows(details, new Set(facts.map((row) => row.label)), lang)],
    stage,
    strengths: strengths.length ? strengths : [text.strengths.fallback],
    risks,
    competitors: picks.map((row) => {
      const shown = localizeProject(row.project, lang);
      return { id: shown.id, title: shown.title, sector: shown.sector?.name ?? null, stage: shown.stage?.name ?? null, why: ruleWhy(row, lang) };
    }),
    disclaimer: text.disclaimer,
    generatedAt: new Date(now).toISOString(),
    source: 'rules',
  };
}

const systemPrompt = (lang: AppLang): string =>
  [
    'You are «المستشار», the adviser of نادي المستثمرين (a Saudi business club). You turn ONE project of the club\'s Projects Bank into a short brief for a member.',
    'Use ONLY the project data you are given. Never invent a number, a name, a market size, a customer or a date; quote numbers exactly as written or leave them out.',
    'Never promise or estimate returns or profits, never call anything guaranteed or safe, never advise to invest. No contact data of any kind (phones, e-mails, links, handles).',
    'Describe what the project IS. Never say what it asks for: no funding sought, no investment amount, no capital, no valuation, no equity or share on offer, no founder name.',
    ...TEXT[lang].language,
    'Return: summary (2 to 4 sentences: what it is, for whom, how it earns, where it stands); table (up to 8 rows «label, value» with the facts a partner asks about first, taken from the text: product, customers, revenue model, location, team… skip a row when the text does not say); strengths (up to 4); risks (up to 4, honest and specific to what the text says or leaves out); competitors: for EVERY competitor id you were given, one sentence «why» it is comparable, from the two descriptions only; stageKey: where the project stands TODAY by what the description says already exists (idea = an idea or a study; prototype = founding, building or a first version; launch = launched and operating; revenue = sales or income already coming in; growth = already expanding to new markets or branches). Plans, goals and ambitions never count; «unknown» whenever the text does not say it plainly.',
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
        stageKey: { type: 'string', enum: ['idea', 'prototype', 'launch', 'revenue', 'growth', 'unknown'] },
      },
      required: ['summary', 'table', 'strengths', 'risks', 'competitors', 'stageKey'],
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
    stageKey: z.enum(['idea', 'prototype', 'launch', 'revenue', 'growth', 'unknown']),
  })
  .strict();

type Stored = { hash: string; brief: ProjectBrief; retryAt?: number };
type Deps = { kv: KV; log: FastifyBaseLogger; apiKey?: string; model: string; fetchImpl?: FetchImpl };

export class BriefService {
  private readonly inflight = new Map<string, Promise<ProjectBrief>>();
  private readonly limiter = new RateLimiter();

  constructor(private readonly deps: Deps) {}

  get mode(): 'openai' | 'rules' {
    return this.deps.apiKey ? 'openai' : 'rules';
  }

  /** `project` and `all` are the Arabic data of the feed; `lang` is the language the brief is written in. */
  brief(project: PublicProject, all: PublicProject[], now = Date.now(), lang: AppLang = 'ar'): Promise<ProjectBrief> {
    const key = `${project.id}:${lang}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const run = this.build(project, all, now, lang).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  private async build(project: PublicProject, all: PublicProject[], now: number, lang: AppLang): Promise<ProjectBrief> {
    const shown = localizeProject(project, lang);
    const details = publicProse(shown.details);
    const picks = pickCompetitors(project, all);
    const content = [VERSION, lang, this.mode, shown.number, shown.title, shown.companyName, shown.founderName, shown.sector?.name, shown.stage?.name, shown.excerpt, details, shown.isGolden, shown.hasPitchDeck, picks.map((row) => [row.project.id, localizeProject(row.project, lang).title])];
    const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    const stored = await this.deps.kv.get<Stored>(briefKey(project.id, lang));
    if (stored?.hash === hash && (stored.brief.source === 'ai' || this.mode === 'rules' || now < (stored.retryAt ?? 0))) return stored.brief;

    const rules = rulesBrief(shown, details, picks, now, lang);
    let brief = rules;
    if (this.deps.apiKey && this.limiter.hit('brief', AI_PER_HOUR, 3_600_000)) {
      try {
        brief = await this.worded(shown, details, picks, rules, lang);
      } catch (error) {
        this.deps.log.warn({ project: project.id, lang, reason: error instanceof Error ? error.message : 'unknown' }, 'AI project brief failed, the rules wrote it');
      }
    }
    // A failed call is tried again later; the rules' answer serves meanwhile.
    await this.deps.kv.set(briefKey(project.id, lang), { hash, brief, ...(brief.source === 'rules' && this.mode === 'openai' ? { retryAt: now + RETRY_MS } : {}) } satisfies Stored);
    return brief;
  }

  private async worded(project: PublicProject, details: string, picks: Ranked[], rules: ProjectBrief, lang: AppLang): Promise<ProjectBrief> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const payload = {
      project: { title: project.title, company: project.companyName, sector: project.sector?.name ?? null, stage: project.stage?.name ?? null, golden: project.isGolden, description: details.slice(0, 5000) },
      competitors: picks.map((row) => {
        const shown = localizeProject(row.project, lang);
        return { id: shown.id, title: shown.title, sector: shown.sector?.name ?? null, stage: shown.stage?.name ?? null, description: publicProse(shown.excerpt ?? makeExcerpt(shown.details ?? '', 300)).slice(0, 400) };
      }),
    };
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.deps.model,
        temperature: 0.3,
        response_format: RESPONSE_FORMAT,
        messages: [
          { role: 'system', content: systemPrompt(lang) },
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
    const sound = (value: string): boolean => !PROMISE.test(value) && !hasContact(value) && !mentionsFunding(value) && [...numbersOf(value)].every((run) => allowed.has(run));
    const summary = fixWording(answer.summary, lang);
    if (!sound(summary) || YIELD.test(summary)) throw new Error('the summary breaks a wording rule');
    const facts = factRows(project, lang);
    const taken = new Set(facts.map((row) => row.label));
    const extra = answer.table
      .map((row) => ({ label: fixWording(row.label, lang), value: fixWording(row.value, lang) }))
      .filter((row) => sound(row.value) && sound(row.label) && !RETURNS.test(row.label + row.value) && !CONTACT_LABEL.test(row.label) && !ASK_LABEL.test(row.label) && !taken.has(row.label))
      .slice(0, 8);
    const lines = (items: string[], fallback: string[]): string[] => {
      const kept = items.map((item) => fixWording(item, lang)).filter((item) => sound(item) && !YIELD.test(item)).slice(0, 4);
      return kept.length ? kept : fallback;
    };
    const whys = new Map(answer.competitors.map((row) => [row.id, fixWording(row.why, lang)]));
    // The site's own stage wins. Only a project it does not place («أخرى», empty) takes the adviser's reading, marked as such.
    const guess = rules.stage.index < 0 ? STAGES.findIndex((stage) => stage.key === answer.stageKey) : -1;
    const guessed = guess >= 0 ? STAGES[guess] : undefined;
    const stage: BriefStage = guessed ? { ...rules.stage, key: guessed.key, label: lang === 'en' ? STAGE_EN[guessed.key] : guessed.label, index: guess, estimated: true } : rules.stage;
    this.deps.log.info({ project: project.id, lang, usage: body.usage }, 'project brief worded by OpenAI');
    return {
      ...rules,
      stage,
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
