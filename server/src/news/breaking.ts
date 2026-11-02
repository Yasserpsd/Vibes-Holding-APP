import type { FastifyBaseLogger } from 'fastify';

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
const TICK_MS = 5 * 60_000;
/** Most breaking pushes one member receives per Riyadh day. */
const DAILY_CAP = 2;
/** Quiet hours, Riyadh: nothing between 23:00 and 07:00. */
const QUIET_FROM = 23;
const QUIET_TO = 7;

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

const inQuiet = (hour: number): boolean => (QUIET_FROM < QUIET_TO ? hour >= QUIET_FROM && hour < QUIET_TO : hour >= QUIET_FROM || hour < QUIET_TO);

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

  private async state(day: string): Promise<State> {
    const saved = await this.deps.kv.get<State>(STATE_KEY);
    return saved?.day === day ? saved : { day, sent: 0, ids: [] };
  }

  /** One pass: at most one wave (one push per member, in his language), never past the daily cap. */
  async tick(now = Date.now()): Promise<boolean> {
    if (!this.deps.enabled || this.running) return false;
    this.running = true;
    try {
      if (inQuiet(riyadhHour(now))) return false;
      const day = riyadhDay(now);
      const state = await this.state(day);
      if (state.sent >= DAILY_CAP) return false;
      const arPick = this.deps.news.breaking('ar', now).find((item) => !state.ids.includes(item.id)) ?? null;
      const enPick = this.deps.news.breaking('en', now).find((item) => !state.ids.includes(item.id)) ?? null;
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
