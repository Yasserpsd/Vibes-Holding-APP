import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { KV } from '../store.js';
import type { Translator } from '../translate.js';
import { latin, SECTOR_EN } from './lang.js';
import { stripContacts } from './redact.js';
import type { PublicProject } from './types.js';

/**
 * M180 (owner: «مينفعش الاقي كلمة واحدة عربي لما احوله انجليزي … لو حتي حد كاتب اسمه عربي اوتوماتيك يترجم»):
 * the English app reads every project fully in English. Where the founder left an English field empty on the
 * site, AI writes it once — names transliterated, the rest translated — and it is kept in kv until the Arabic
 * changes. Contact data never reaches the translator (rule 4). The Arabic app and the site are untouched.
 */

const ARABIC = /[؀-ۿ]/;
const KV_KEY = 'projectsBank:english:v1';
const INTERVAL_MS = 60 * 60_000;
const CONCURRENCY = 3;

export const PROJECTS_TRANSLATE_SYSTEM =
  'You turn an Arabic Projects Bank entry of an investors club into English. Transliterate personal names and company or brand names into their standard Latin spelling (keep a brand\'s own Latin spelling when the text shows it); translate project titles, sector names, summaries and details into natural English. Keep numbers, percentages, currencies and dates exactly. Never add, drop or embellish information and never promise returns. Never write "free"; use "at no charge". Reply ONLY with JSON {"texts": string[]} of the same length and order as the input; empty strings stay empty.';

const FIELDS = ['title', 'companyName', 'founderName', 'excerpt', 'details', 'sector'] as const;
type Field = (typeof FIELDS)[number];
export type ProjectEnglish = Partial<Record<Field, string>>;
/** `partial`: only the short name fields are in (the full call failed); the next pass completes the rest. */
type Cached = { hash: string; en: ProjectEnglish; partial?: true };
/** M239 (owner, 2026-11-14): names and titles must never reach the English app in Arabic, so these get a repair + local fallback. */
const NAME_FIELDS = ['title', 'companyName', 'founderName', 'sector'] as const satisfies readonly Field[];

const LETTERS: Record<string, string> = {
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ٱ': 'a', 'ء': '', 'ؤ': 'u', 'ئ': 'e', 'ب': 'b', 'پ': 'p', 'ت': 't', 'ث': 'th', 'ج': 'j', 'چ': 'ch', 'ح': 'h', 'خ': 'kh',
  'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ڤ': 'v', 'ق': 'q',
  'ك': 'k', 'ک': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'ة': 'a', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ی': 'y', 'ـ': '',
};

/** Last resort when the model gave no usable English: a plain, deterministic Latin spelling (no Arabic letters left). */
export function transliterate(text: string): string {
  const spelled = text
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .split(/\s+/)
    .map((word) => {
      const article = /^ال(?=.)/.test(word);
      const body = (article ? word.slice(2) : word).replace(/[ً-ٟ]/g, '');
      const latin = [...body].map((char) => LETTERS[char] ?? (ARABIC.test(char) ? '' : char)).join('');
      if (!latin) return '';
      const cap = latin.charAt(0).toUpperCase() + latin.slice(1);
      return article ? `Al-${cap}` : cap;
    })
    .filter(Boolean);
  return spelled.join(' ');
}
type Stored = { projects: Record<string, Cached>; sectors: Record<string, string> };

/** The Arabic the English app would still show, by field; empty when the project is already English. */
function sourceOf(project: PublicProject): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  const take = (field: Field, english: string | null, arabic: string | null | undefined, clean = false) => {
    if (!latin(english) && arabic && ARABIC.test(arabic)) out[field] = clean ? stripContacts(arabic) : arabic;
  };
  take('title', project.titleEn, project.title);
  take('companyName', project.companyNameEn, project.companyName);
  take('founderName', project.founderNameEn, project.founderName);
  take('excerpt', project.excerptEn, project.excerpt, true);
  take('details', project.detailsEn, project.details, true);
  const sector = project.sector?.name;
  if (sector && !SECTOR_EN[sector]) take('sector', null, sector);
  return out;
}

const hashOf = (source: Partial<Record<Field, string>>): string =>
  createHash('sha256').update(JSON.stringify(FIELDS.map((field) => source[field] ?? ''))).digest('hex');

type Deps = { kv: KV; translator: Translator; log: FastifyBaseLogger; all: () => PublicProject[]; onTranslated?: () => void };

export class ProjectsEnglish {
  private cache: Record<string, Cached> = {};
  /** New sector names the site added after SECTOR_EN, Arabic → English. */
  private sectors: Record<string, string> = {};
  private loaded = false;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly deps: Deps) {}

  /** The AI English of a project, only while it still matches the project's current Arabic. */
  lookup(project: PublicProject): ProjectEnglish | null {
    const cached = this.cache[String(project.id)];
    if (!cached) return null;
    const source = sourceOf(project);
    return Object.keys(source).length > 0 && cached.hash === hashOf(source) ? cached.en : null;
  }

  sector(name: string): string | null {
    return this.sectors[name] ?? null;
  }

  /** One pass: translates every project whose Arabic has no English yet (or changed since). */
  run(): Promise<void> {
    if (this.deps.translator.mode === 'off') return Promise.resolve();
    if (!this.running) {
      this.running = this.pass()
        .catch((error: unknown) => this.deps.log.warn({ err: error }, 'Projects Bank English pass failed'))
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.deps.kv.get<Stored>(KV_KEY);
    this.cache = stored?.projects ?? {};
    this.sectors = stored?.sectors ?? {};
    this.loaded = true;
  }

  private async pass(): Promise<void> {
    await this.load();
    const todo = this.deps.all().filter((project) => this.needsWork(project));
    if (todo.length === 0) return;
    let translated = 0;
    let failed = 0;
    for (let start = 0; start < todo.length; start += CONCURRENCY) {
      const results = await Promise.all(todo.slice(start, start + CONCURRENCY).map((project) => this.translateOne(project)));
      for (const ok of results) if (ok) translated += 1; else failed += 1;
      await this.deps.kv.set(KV_KEY, { projects: this.cache, sectors: this.sectors } satisfies Stored);
    }
    this.deps.log.info({ translated, failed }, 'Projects Bank English pass done');
    if (translated > 0) this.deps.onTranslated?.();
  }

  /** Name fields the project has in Arabic whose English is missing or still holds Arabic letters. */
  private badNames(source: Partial<Record<Field, string>>, en: ProjectEnglish): Field[] {
    return NAME_FIELDS.filter((field) => source[field] !== undefined && (!en[field] || ARABIC.test(en[field] ?? '')));
  }

  private needsWork(project: PublicProject): boolean {
    const source = sourceOf(project);
    if (Object.keys(source).length === 0) return false;
    const cached = this.cache[String(project.id)];
    return !cached || cached.hash !== hashOf(source) || cached.partial === true || this.badNames(source, cached.en).length > 0;
  }

  /**
   * M239: translates what is missing. A new or changed project gets every field; a project already cached gets only
   * the names/titles that came back empty or Arabic (and the rest when an earlier call was partial). A name the model
   * still leaves Arabic gets one retry on its own, then a plain local transliteration, so no Arabic title survives.
   */
  private async translateOne(project: PublicProject): Promise<boolean> {
    const source = sourceOf(project);
    const hash = hashOf(source);
    const prev = this.cache[String(project.id)];
    const current = prev && prev.hash === hash ? prev : undefined;
    const en: ProjectEnglish = { ...(current?.en ?? {}) };
    const full = !current || current.partial === true;
    const bad = this.badNames(source, en);
    const wanted = FIELDS.filter((field) => source[field] !== undefined && ((full && !en[field]) || bad.includes(field)));
    if (wanted.length === 0) return true;
    const ask = async (fields: Field[]): Promise<boolean> => {
      const out = await this.deps.translator.translate(fields.map((field) => source[field] ?? ''));
      if (!out) return false;
      fields.forEach((field, index) => {
        const text = out[index];
        if (text && (!(NAME_FIELDS as readonly Field[]).includes(field) || !ARABIC.test(text))) en[field] = text;
      });
      return true;
    };
    let partial = false;
    if (!(await ask(wanted))) {
      // The long texts may be what made the call fail: keep the short names at least, and finish the rest next pass.
      const names = wanted.filter((field) => (NAME_FIELDS as readonly Field[]).includes(field));
      if (names.length === wanted.length || names.length === 0 || !(await ask(names))) return false;
      partial = true;
    }
    const stillBad = this.badNames(source, en);
    if (stillBad.length > 0 && !partial) await ask(stillBad);
    for (const field of this.badNames(source, en)) {
      const latin = transliterate(source[field] ?? '');
      if (latin) en[field] = latin;
    }
    if (source.sector && en.sector) this.sectors[source.sector] = en.sector;
    this.cache[String(project.id)] = partial ? { hash, en, partial: true } : { hash, en };
    return true;
  }

  async start(): Promise<void> {
    await this.load();
    if (this.deps.translator.mode === 'off' || this.timer) return;
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
