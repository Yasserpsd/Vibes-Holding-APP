import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sentOnly } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { PushMessage, PushService } from '../push/service.js';
import { riyadhDay, riyadhHour } from '../riyadh.js';
import type { KV } from '../store.js';
import type { NewsService } from './service.js';
import type { NewsItem } from './types.js';

/**
 * M182b (owner, 2026-11-02, «إشعار للخبر الناري … الأخبار الشقية اوي»): a push when a money story
 * with a hard-hitting headline lands (NewsService.breaking: 2 h fresh, spark ≥ 20). Same guardrails
 * as the market alerts (M179): a daily cap, quiet hours, one mark written before the sends, the
 * NEWS_BREAKING env kills it cold. Rule 7 holds — the push carries the source's own headline and
 * name, nothing written by AI; each device gets the pick of its own language (M180: no Arabic
 * reaches the English app), and a language with no pick that day simply gets nothing.
 */
const STATE_KEY = 'news:breaking:state';
const SETTINGS_KEY = 'news:breaking:settings';
const TICK_MS = 5 * 60_000;

/** M182c: the owner tunes it from the dashboard card (defaults below; «استرجاع» = save the defaults). */
export type BreakingSettings = {
  enabled: boolean;
  /** Most breaking waves one member receives per Riyadh day. */
  dailyCap: number;
  /** Quiet hours (Riyadh, 0–23): nothing from `quietFrom` up to `quietTo`. Equal values = no quiet hours. */
  quietFrom: number;
  quietTo: number;
  /** The spark score a headline must reach (10 per hit, so 20 = two hits). */
  minSpark: number;
};

export const BREAKING_DEFAULTS: BreakingSettings = { enabled: true, dailyCap: 2, quietFrom: 23, quietTo: 7, minSpark: 20 };

const settingsSchema = z.object({
  enabled: z.boolean(),
  dailyCap: z.number().int().min(1).max(10),
  quietFrom: z.number().int().min(0).max(23),
  quietTo: z.number().int().min(0).max(23),
  minSpark: z.number().int().min(10).max(50),
});

type State = { day: string; sent: number; ids: string[] };

export function breakingMessage(item: NewsItem): PushMessage {
  const english = item.lang === 'en';
  return {
    // The source's own headline, under a plain «this is news» banner that names the source (rule 7).
    title: english ? `Breaking · ${item.sourceName}` : `عاجل من ${item.sourceName}`,
    body: item.title,
    data: { screen: `/news/${item.id}`, type: 'news-breaking', id: item.id },
  };
}

type Deps = {
  kv: KV;
  log: FastifyBaseLogger;
  news: NewsService;
  push: PushService;
  /** '0' kills the whole thing cold (NEWS_BREAKING). */
  enabled: boolean;
};

const inQuiet = (settings: BreakingSettings, hour: number): boolean => {
  const { quietFrom: from, quietTo: to } = settings;
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
};

export class BreakingNewsService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: Deps) {}

  start(): void {
    if (!this.deps.enabled) return;
    this.timer = setInterval(() => void this.tick().catch((error) => this.deps.log.warn({ err: error }, 'breaking news tick failed')), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async settings(): Promise<BreakingSettings> {
    const saved = await this.deps.kv.get<Partial<BreakingSettings>>(SETTINGS_KEY);
    return { ...BREAKING_DEFAULTS, ...saved };
  }

  async save(patch: Partial<BreakingSettings>): Promise<BreakingSettings> {
    const next = { ...(await this.settings()), ...patch };
    await this.deps.kv.set(SETTINGS_KEY, next);
    return next;
  }

  private async state(day: string): Promise<State> {
    const saved = await this.deps.kv.get<State>(STATE_KEY);
    return saved?.day === day ? saved : { day, sent: 0, ids: [] };
  }

  /** For the dashboard card: today's sends and what qualifies right now. */
  async status(now = Date.now()): Promise<{ enabled: boolean; sentToday: number; sentIds: string[]; candidates: { lang: string; id: string; title: string; sourceName: string }[] }> {
    const settings = await this.settings();
    const state = await this.state(riyadhDay(now));
    const candidates = (['ar', 'en'] as const).flatMap((lang) =>
      this.deps.news.breaking(lang, now, undefined, settings.minSpark).slice(0, 3).map((item) => ({ lang, id: item.id, title: item.title, sourceName: item.sourceName })),
    );
    return { enabled: this.deps.enabled, sentToday: state.sent, sentIds: state.ids, candidates };
  }

  /** One pass: at most one wave (one push per member, in his language), never past the daily cap. */
  async tick(now = Date.now()): Promise<boolean> {
    if (!this.deps.enabled || this.running) return false;
    this.running = true;
    try {
      const settings = await this.settings();
      if (!settings.enabled || inQuiet(settings, riyadhHour(now))) return false;
      const day = riyadhDay(now);
      const state = await this.state(day);
      if (state.sent >= settings.dailyCap) return false;
      const arPick = this.deps.news.breaking('ar', now, undefined, settings.minSpark).find((item) => !state.ids.includes(item.id)) ?? null;
      const enPick = this.deps.news.breaking('en', now, undefined, settings.minSpark).find((item) => !state.ids.includes(item.id)) ?? null;
      if (!arPick && !enPick) return false;
      // The mark lands BEFORE the sends: a crash mid-way never double-messages the members.
      const ids = [arPick?.id, enPick?.id].filter((id): id is string => Boolean(id));
      await this.deps.kv.set(STATE_KEY, { day, sent: state.sent + 1, ids: [...state.ids, ...ids] });
      const outcome = await this.deps.push.broadcastEach((device) => {
        const pick = device.lang === 'en' ? enPick : arPick;
        return pick ? breakingMessage(pick) : null;
      });
      this.deps.log.info({ ar: arPick?.id ?? null, en: enPick?.id ?? null, ...outcome }, 'breaking news push');
      return true;
    } finally {
      this.running = false;
    }
  }
}

export type BreakingRoutesOptions = { service: BreakingNewsService; news: NewsService; push: PushService; auth: AuthService };

/** M182c: the owner's dashboard card — on/off, cap, quiet hours, spark bar, today's sends, and a test push to his own device. */
export const breakingNewsRoutes: FastifyPluginAsync<BreakingRoutesOptions> = async (app, { service, news, push, auth }) => {
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/admin/news/breaking',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      void reply.header('cache-control', 'no-store');
      const [settings, status] = await Promise.all([service.settings(), service.status()]);
      return { settings, defaults: BREAKING_DEFAULTS, ...status };
    }),
  );

  app.put(
    '/api/admin/news/breaking',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const body = parse(settingsSchema.partial(), request.body, reply);
      if (!body) return;
      const settings = await service.save(sentOnly(body, request.body));
      return { ok: true, settings };
    }),
  );

  // A sample of the real message for the current hottest story (spark bar ignored), to the admin's own devices only.
  app.post(
    '/api/admin/news/breaking/test',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const item = news.breaking('ar', Date.now(), 24 * 3_600_000, 0)[0];
      if (!item) return reply.code(503).send({ error: { code: 'unavailable', message: 'لا توجد أخبار مال وأعمال حديثة الآن' } });
      const message = breakingMessage(item);
      const outcome = await push.send(admin.session.contactId, { ...message, title: `(تجربة) ${message.title}` });
      return { ok: true, ...outcome, message };
    }),
  );
};
