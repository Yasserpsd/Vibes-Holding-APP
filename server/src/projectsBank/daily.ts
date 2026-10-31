import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import type { AppLang } from '../lang.js';
import type { FetchImpl } from '../news/rss.js';
import type { PushMessage, PushOutcome } from '../push/service.js';
import { riyadhDay, riyadhHour } from '../riyadh.js';
import type { KV } from '../store.js';
import { localizeProject } from './lang.js';
import { hasContact, stripContacts, stripFunding } from './redact.js';
import { makeExcerpt } from './text.js';
import type { PublicProject } from './types.js';

/**
 * M170 «مشروع اليوم» (owner, 2026-10-31): every day the AI picks ONE project of the Projects Bank and every
 * device — neutral, entrepreneur and investor alike — gets one push that opens the project screen.
 * The pick comes from the PUBLIC project fields only (`PublicProject` carries no founder contact, no pitch
 * deck — CLAUDE.md rule 4) and the founder's own text passes `stripContacts`/`stripFunding` before it is
 * shown or handed to the model. The model only CHOOSES an id from a shortlist; it writes nothing the member
 * reads. Without a key, or when the call fails, the rules choose: the most viewed project not shown lately.
 * State lives in kv: today's pick, when it went out, the ids shown recently (never twice in ~60 days).
 */
export const DAILY_PROJECT_KEY = 'projectsBank:daily';
/** Riyadh hour at/after which the day's push goes out (the news editions are 10:00 and 19:00). */
export const DAILY_PROJECT_HOUR = 12;
const RECENT_MAX = 60;
const SHORTLIST = 20;
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 20_000;
const BODY_EXCERPT = 110;

export type DailyProjectState = {
  /** Riyadh day of the current pick. */
  day: string | null;
  projectId: number | null;
  pushedAt: string | null;
  /** How the pick was made: the model's one-line reason, or the rule. Dashboard reading only. */
  reason: string | null;
  recentIds: number[];
  /** The owner's switch (dashboard); default on. */
  enabled: boolean;
};

export type DailyProjectResult = { projectId: number; title: string; reason: string | null; sent: number; failed: number };

type ProjectsLike = { all(): PublicProject[]; get(id: number): PublicProject | null };
type PushLike = { broadcastEach(choose: (device: { contactId: number; persona: string | null; lang: AppLang | null }) => Promise<PushMessage | null> | PushMessage | null): Promise<PushOutcome> };

type Deps = { kv: KV; log: FastifyBaseLogger; projects: ProjectsLike; push: PushLike; apiKey?: string; model: string; fetchImpl?: FetchImpl };

const TITLE: Record<AppLang, string> = { ar: 'مشروع اليوم من بنك المشاريع', en: 'Project of the day from the Projects Bank' };

const answerSchema = z.object({ id: z.coerce.number().int(), reason: z.string().max(300).optional() });

const SYSTEM_PROMPT =
  'You choose which project of a Saudi business club\'s Projects Bank is presented to all members today. You receive a JSON shortlist of projects (id, title, sector, stage, excerpt). Pick exactly ONE id: the project a member would most like to discover today — a clear idea, a real product or service, a described business model, a concrete sector; prefer variety over hype. Never invent anything, never judge returns or valuations. Answer with JSON only: {"id": <one id from the list>, "reason": "<one short sentence, same language as the project texts>"}.';
const RESPONSE_FORMAT = { type: 'json_object' } as const;

const emptyState = (): DailyProjectState => ({ day: null, projectId: null, pushedAt: null, reason: null, recentIds: [], enabled: true });

/** The founder's text as it may leave: no contact data, no funding ask, one short excerpt. */
function publicExcerpt(project: PublicProject, max = BODY_EXCERPT): string {
  const source = project.excerpt ?? (project.details ? makeExcerpt(project.details, 300) : '');
  const clean = stripFunding(stripContacts(source));
  if (!clean || hasContact(clean)) return '';
  return makeExcerpt(clean, max);
}

export class DailyProjectService {
  private state: DailyProjectState | null = null;
  private inflight: Promise<unknown> | null = null;

  constructor(private readonly deps: Deps) {}

  async load(): Promise<DailyProjectState> {
    if (!this.state) this.state = { ...emptyState(), ...((await this.deps.kv.get<Partial<DailyProjectState>>(DAILY_PROJECT_KEY)) ?? {}) };
    return this.state;
  }

  private async save(): Promise<void> {
    if (this.state) await this.deps.kv.set(DAILY_PROJECT_KEY, this.state);
  }

  async setEnabled(enabled: boolean): Promise<DailyProjectState> {
    const state = await this.load();
    state.enabled = enabled;
    await this.save();
    return state;
  }

  /** The scheduled tick (every few minutes): once per Riyadh day, at/after DAILY_PROJECT_HOUR, when the switch is on. */
  async run(now = Date.now()): Promise<DailyProjectResult | null> {
    try {
      const state = await this.load();
      if (!state.enabled || riyadhHour(now) < DAILY_PROJECT_HOUR) return null;
      const day = riyadhDay(now);
      if (state.day === day && state.pushedAt) return null;
      return await this.sendToday(now, { force: false });
    } catch (error) {
      this.deps.log.error({ err: error }, 'daily project push failed');
      return null;
    }
  }

  /** The owner's «ابعت مشروع اليوم دلوقتي»: a fresh pick goes out now, whatever the hour and whether today's went already. */
  sendNow(now = Date.now()): Promise<DailyProjectResult | null> {
    return this.sendToday(now, { force: true });
  }

  private sendToday(now: number, options: { force: boolean }): Promise<DailyProjectResult | null> {
    // One send at a time: the tick and the owner's button never race into two pushes.
    if (this.inflight) return this.inflight.then(() => null);
    const run = this.doSend(now, options).finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async doSend(now: number, options: { force: boolean }): Promise<DailyProjectResult | null> {
    const state = await this.load();
    const day = riyadhDay(now);
    // A pick made earlier today that reached nobody (no devices yet, Expo down) is retried; a forced send picks afresh.
    const kept = !options.force && state.day === day && state.projectId ? this.deps.projects.get(state.projectId) : null;
    const picked = kept ? { project: kept, reason: state.reason } : await this.pick(state.recentIds);
    if (!picked) {
      this.deps.log.warn('daily project push: the Projects Bank is empty');
      return null;
    }
    const { project, reason } = picked;
    state.day = day;
    state.projectId = project.id;
    state.reason = reason;
    if (!kept) {
      state.recentIds = [...state.recentIds.filter((id) => id !== project.id), project.id].slice(-RECENT_MAX);
      state.pushedAt = null;
    }
    await this.save();
    const messages: Record<AppLang, PushMessage> = { ar: messageOf(project, 'ar'), en: messageOf(project, 'en') };
    const outcome = await this.deps.push.broadcastEach((device) => messages[device.lang === 'en' ? 'en' : 'ar']);
    if (outcome.sent > 0) {
      state.pushedAt = new Date(now).toISOString();
      await this.save();
    }
    this.deps.log.info({ project: project.id, title: project.title, reason, ...outcome }, 'daily project push');
    return { projectId: project.id, title: project.title, reason, sent: outcome.sent, failed: outcome.failed };
  }

  /** The shortlist: projects not shown lately, those with a picture and a description first, then the most viewed. */
  shortlist(recentIds: number[]): PublicProject[] {
    const all = this.deps.projects.all();
    if (!all.length) return [];
    const recent = new Set(recentIds);
    const fresh = all.filter((project) => !recent.has(project.id));
    const pool = fresh.length ? fresh : all; // every project shown once: the rotation starts over
    const weight = (project: PublicProject): number => (project.image ? 2 : 0) + (project.details && project.details.length > 200 ? 1 : 0);
    return [...pool].sort((a, b) => weight(b) - weight(a) || b.viewsCount - a.viewsCount || b.id - a.id).slice(0, SHORTLIST);
  }

  /** The model chooses one id of the shortlist; the rules take the first entry when there is no key or the answer is unusable. */
  async pick(recentIds: number[]): Promise<{ project: PublicProject; reason: string | null } | null> {
    const shortlist = this.shortlist(recentIds);
    const first = shortlist[0];
    if (!first) return null;
    if (!this.deps.apiKey || shortlist.length < 2) return { project: first, reason: null };
    try {
      const chosen = await this.ask(shortlist);
      const project = shortlist.find((entry) => entry.id === chosen.id);
      if (!project) throw new Error(`the model chose id ${chosen.id}, not in the shortlist`);
      const reason = chosen.reason && !hasContact(chosen.reason) ? chosen.reason.trim().slice(0, 300) : null;
      return { project, reason };
    } catch (error) {
      this.deps.log.warn({ err: error }, 'daily project: the model did not choose, the rules did');
      return { project: first, reason: null };
    }
  }

  private async ask(shortlist: PublicProject[]): Promise<{ id: number; reason?: string }> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const payload = {
      projects: shortlist.map((project) => ({
        id: project.id,
        title: project.title,
        sector: project.sector?.name ?? null,
        stage: project.stage?.name ?? null,
        excerpt: publicExcerpt(project, 300),
      })),
    };
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.deps.model,
        temperature: 0.4,
        response_format: RESPONSE_FORMAT,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('OpenAI answer has no content');
    return answerSchema.parse(JSON.parse(content));
  }
}

/** The push of one language: the title line, the project's name and sector, one clean excerpt, and the project screen. */
export function messageOf(project: PublicProject, lang: AppLang): PushMessage {
  const shown = localizeProject(project, lang);
  const head = [shown.title, shown.sector?.name].filter((part): part is string => Boolean(part)).join(' · ');
  const excerpt = publicExcerpt(shown);
  return {
    title: TITLE[lang],
    body: excerpt ? `${head}\n${excerpt}` : head,
    data: { type: 'project', projectId: String(project.id), screen: `/project/${project.id}` },
  };
}
