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
 * M222 (owner, 2026-11-09: «كل يوم مشروعين … وحاول ديما تختار مشروع من المشاريع الذهبية وسطهم»): two pushes a day,
 * a golden project at noon and one of the rest of the bank in the evening.
 * State lives in kv: the current pick, when it went out, the ids shown recently (never twice in ~60 days).
 */
export const DAILY_PROJECT_KEY = 'projectsBank:daily';
/** Riyadh hours of the day's two pushes; the first one carries a golden project. */
export const DAILY_PROJECT_HOURS = [12, 20] as const;
const GOLDEN_HOUR = DAILY_PROJECT_HOURS[0];
const RECENT_MAX = 120;
const SHORTLIST = 20;
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 20_000;
const BODY_EXCERPT = 110;

export type DailyProjectState = {
  /** Riyadh day of the current pick. */
  day: string | null;
  /** `YYYY-MM-DD#HH` of the scheduled push the current pick belongs to. */
  slot: string | null;
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
const GOLDEN_TITLE: Record<AppLang, string> = { ar: 'مشروع ذهبي من بنك المشاريع', en: 'A golden project from the Projects Bank' };

const answerSchema = z.object({ id: z.coerce.number().int(), reason: z.string().max(300).optional() });

const SYSTEM_PROMPT =
  'You choose which project of a Saudi business club\'s Projects Bank is presented to all members today. You receive a JSON shortlist of projects (id, title, sector, stage, excerpt). Pick exactly ONE id: the project a member would most like to discover today — a clear idea, a real product or service, a described business model, a concrete sector; prefer variety over hype. Never invent anything, never judge returns or valuations. Answer with JSON only: {"id": <one id from the list>, "reason": "<one short sentence, same language as the project texts>"}.';
const RESPONSE_FORMAT = { type: 'json_object' } as const;

const emptyState = (): DailyProjectState => ({ day: null, slot: null, projectId: null, pushedAt: null, reason: null, recentIds: [], enabled: true });

type ProjectSlot = { key: string; golden: boolean };

/** The scheduled push due at this moment, or null before the day's first hour. */
export function projectSlotOf(now: number): ProjectSlot | null {
  const hour = riyadhHour(now);
  const due = DAILY_PROJECT_HOURS.filter((slot) => hour >= slot).at(-1);
  return due === undefined ? null : { key: `${riyadhDay(now)}#${due}`, golden: due === GOLDEN_HOUR };
}

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
    if (!this.state) {
      this.state = { ...emptyState(), ...((await this.deps.kv.get<Partial<DailyProjectState>>(DAILY_PROJECT_KEY)) ?? {}) };
      // A state saved before M222 knew one push a day, at noon: the day it ran does not get that push twice.
      if (this.state.day && !this.state.slot) this.state.slot = `${this.state.day}#${GOLDEN_HOUR}`;
    }
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

  /** The scheduled tick (every few minutes): one send per slot of DAILY_PROJECT_HOURS, when the switch is on. */
  async run(now = Date.now()): Promise<DailyProjectResult | null> {
    try {
      const state = await this.load();
      const slot = projectSlotOf(now);
      if (!state.enabled || !slot) return null;
      if (state.slot === slot.key && state.pushedAt) return null;
      return await this.send(now, slot);
    } catch (error) {
      this.deps.log.error({ err: error }, 'daily project push failed');
      return null;
    }
  }

  /** The owner's «ابعت مشروع دلوقتي»: a fresh pick goes out now, on top of the day's two; the schedule stays untouched. */
  sendNow(now = Date.now()): Promise<DailyProjectResult | null> {
    return this.send(now, null);
  }

  private send(now: number, slot: ProjectSlot | null): Promise<DailyProjectResult | null> {
    // One send at a time: the tick and the owner's button never race into two pushes.
    if (this.inflight) return this.inflight.then(() => null);
    const run = this.doSend(now, slot).finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async doSend(now: number, slot: ProjectSlot | null): Promise<DailyProjectResult | null> {
    const state = await this.load();
    // A slot's pick that reached nobody (no devices yet, Expo down) is retried; a manual send picks afresh.
    const kept = slot && state.slot === slot.key && state.projectId ? this.deps.projects.get(state.projectId) : null;
    const picked = kept ? { project: kept, reason: state.reason } : await this.pick(state.recentIds, slot?.golden ?? false);
    if (!picked) {
      this.deps.log.warn('daily project push: the Projects Bank is empty');
      return null;
    }
    const { project, reason } = picked;
    state.day = riyadhDay(now);
    state.slot = slot?.key ?? state.slot;
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

  /** The shortlist of one kind (golden, or the rest of the bank): not shown lately, those with a picture and a description first, then the most viewed. */
  shortlist(recentIds: number[], golden = false): PublicProject[] {
    const all = this.deps.projects.all();
    if (!all.length) return [];
    const ofKind = all.filter((project) => project.isGolden === golden);
    const source = ofKind.length ? ofKind : all;
    const recent = new Set(recentIds);
    const fresh = source.filter((project) => !recent.has(project.id));
    // Every project shown once: the rotation starts over from the half shown longest ago.
    const pool = fresh.length ? fresh : [...source].sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id)).slice(0, Math.ceil(source.length / 2));
    const weight = (project: PublicProject): number => (project.image ? 2 : 0) + (project.details && project.details.length > 200 ? 1 : 0);
    return [...pool].sort((a, b) => weight(b) - weight(a) || b.viewsCount - a.viewsCount || b.id - a.id).slice(0, SHORTLIST);
  }

  /** The model chooses one id of the shortlist; the rules take the first entry when there is no key or the answer is unusable. */
  async pick(recentIds: number[], golden = false): Promise<{ project: PublicProject; reason: string | null } | null> {
    const shortlist = this.shortlist(recentIds, golden);
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
    title: (project.isGolden ? GOLDEN_TITLE : TITLE)[lang],
    body: excerpt ? `${head}\n${excerpt}` : head,
    data: { type: 'project', projectId: String(project.id), screen: `/project/${project.id}` },
  };
}
