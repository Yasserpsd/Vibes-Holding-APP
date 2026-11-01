import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { KV } from '../store.js';
import type { Translator } from '../translate.js';
import { SECTOR_EN } from './lang.js';
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
type Cached = { hash: string; en: ProjectEnglish };
type Stored = { projects: Record<string, Cached>; sectors: Record<string, string> };

/** The Arabic the English app would still show, by field; empty when the project is already English. */
function sourceOf(project: PublicProject): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  const take = (field: Field, english: string | null, arabic: string | null | undefined, clean = false) => {
    if (!english && arabic && ARABIC.test(arabic)) out[field] = clean ? stripContacts(arabic) : arabic;
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
    const todo = this.deps.all().filter((project) => {
      const source = sourceOf(project);
      return Object.keys(source).length > 0 && this.cache[String(project.id)]?.hash !== hashOf(source);
    });
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

  private async translateOne(project: PublicProject): Promise<boolean> {
    const source = sourceOf(project);
    const fields = FIELDS.filter((field) => source[field] !== undefined);
    const out = await this.deps.translator.translate(fields.map((field) => source[field] ?? ''));
    if (!out) return false;
    const en: ProjectEnglish = {};
    fields.forEach((field, index) => {
      if (out[index]) en[field] = out[index];
    });
    if (source.sector && en.sector) this.sectors[source.sector] = en.sector;
    this.cache[String(project.id)] = { hash: hashOf(source), en };
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
