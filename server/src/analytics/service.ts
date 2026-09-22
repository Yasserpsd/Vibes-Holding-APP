import type { FastifyBaseLogger } from 'fastify';

import { riyadhDay } from '../riyadh.js';
import type { KV } from '../store.js';

/**
 * M33 (M22 inside it): usage analytics, aggregates only. The app reports which screens were opened
 * (batched, JS only, no third-party service); the advisor, Projects Bank unlock and news routes count
 * themselves through one hook in app.ts. Everything lands in one small document per Riyadh day:
 * views per screen, event counters, and the day's visitors as opaque keys (`c:<contactId>` or
 * `d:<device>`) used only to count unique visitors — never who watched what (the store data-safety
 * forms of M8 say so). Counts sit in memory first and reach the store every few seconds.
 */
export type EventKey = 'advisorMessages' | 'pbUnlocks' | 'newsReads';
export const EVENT_KEYS: readonly EventKey[] = ['advisorMessages', 'pbUnlocks', 'newsReads'];

export type AnalyticsDayDoc = {
  screens: Record<string, number>;
  events: Partial<Record<EventKey, number>>;
  visitors: string[];
};

/** One day as the dashboard reads it: the visitors list stays inside the store. */
export type AnalyticsDay = {
  day: string;
  visitors: number;
  views: number;
  screens: Record<string, number>;
  events: Record<EventKey, number>;
};

export const ANALYTICS_INDEX_KEY = 'analytics:index';
export const analyticsDayKey = (day: string): string => `analytics:days:${day}`;

const FLUSH_MS = 15_000;
const KEEP_DAYS = 400;
const MAX_SCREENS_PER_DAY = 200;
const MAX_VISITORS_PER_DAY = 20_000;
const SCREEN_NAME = /^[a-z0-9/\[\]()._-]{1,64}$/i;

type Pending = { screens: Map<string, number>; events: Map<EventKey, number>; visitors: Set<string> };

const emptyPending = (): Pending => ({ screens: new Map(), events: new Map(), visitors: new Set() });

export const isScreenName = (value: string): boolean => SCREEN_NAME.test(value);

type Deps = { kv: KV; log: FastifyBaseLogger };

export class AnalyticsService {
  /** Counts since the last flush, by Riyadh day (a batch near midnight lands on the new day). */
  private pending = new Map<string, Pending>();
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  private day(now: number): Pending {
    const day = riyadhDay(now);
    let pending = this.pending.get(day);
    if (!pending) {
      pending = emptyPending();
      this.pending.set(day, pending);
    }
    return pending;
  }

  /** One screens batch from the app. Bad names are dropped quietly; the visitor counts once per day. */
  screens(batch: string[], visitor: string, now = Date.now()): void {
    const pending = this.day(now);
    for (const screen of batch) {
      if (!isScreenName(screen)) continue;
      pending.screens.set(screen, (pending.screens.get(screen) ?? 0) + 1);
    }
    pending.visitors.add(visitor);
  }

  /** One counted act (an advisor message, a Projects Bank unlock, a news item opened). */
  hit(event: EventKey, visitor: string | null = null, now = Date.now()): void {
    const pending = this.day(now);
    pending.events.set(event, (pending.events.get(event) ?? 0) + 1);
    if (visitor) pending.visitors.add(visitor);
  }

  /** Merges the pending counts into their day documents; serialized, and never throws (analytics must not break a request). */
  flush(): Promise<void> {
    if (this.pending.size === 0) return Promise.resolve();
    const taken = this.pending;
    this.pending = new Map();
    const run = this.chain.then(async () => {
      for (const [day, pending] of taken) {
        try {
          await this.merge(day, pending);
        } catch (error) {
          this.deps.log.warn({ day, reason: error instanceof Error ? error.message : 'unknown' }, 'analytics day not saved');
        }
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async merge(day: string, pending: Pending): Promise<void> {
    const stored = (await this.deps.kv.get<AnalyticsDayDoc>(analyticsDayKey(day))) ?? { screens: {}, events: {}, visitors: [] };
    const screens: Record<string, number> = { ...stored.screens };
    for (const [screen, count] of pending.screens) {
      // A flood of unknown names never grows the document without bound: extra screens fold into one row.
      const name = screens[screen] !== undefined || Object.keys(screens).length < MAX_SCREENS_PER_DAY ? screen : 'other';
      screens[name] = (screens[name] ?? 0) + count;
    }
    const events: AnalyticsDayDoc['events'] = { ...stored.events };
    for (const [event, count] of pending.events) events[event] = (events[event] ?? 0) + count;
    const visitors = new Set(Array.isArray(stored.visitors) ? stored.visitors : []);
    for (const visitor of pending.visitors) {
      if (visitors.size >= MAX_VISITORS_PER_DAY) break;
      visitors.add(visitor);
    }
    await this.deps.kv.set(analyticsDayKey(day), { screens, events, visitors: [...visitors] } satisfies AnalyticsDayDoc);
    await this.index(day);
  }

  /** The list of recorded days (kv cannot list keys); days beyond the keep window are deleted with their documents. */
  private async index(day: string): Promise<void> {
    const stored = (await this.deps.kv.get<{ days: string[] }>(ANALYTICS_INDEX_KEY))?.days ?? [];
    if (stored.includes(day)) return;
    const days = [...stored, day].sort();
    const cutoff = riyadhDay(Date.now() - KEEP_DAYS * 86_400_000);
    const kept: string[] = [];
    for (const entry of days) {
      if (entry < cutoff) await this.deps.kv.delete(analyticsDayKey(entry));
      else kept.push(entry);
    }
    await this.deps.kv.set(ANALYTICS_INDEX_KEY, { days: kept });
  }

  /** The last `days` Riyadh days for the dashboard, oldest first, empty days included so charts keep their axis. */
  async overview(days: number, now = Date.now()): Promise<{ days: AnalyticsDay[] }> {
    await this.flush();
    const out: AnalyticsDay[] = [];
    for (let back = days - 1; back >= 0; back -= 1) {
      const day = riyadhDay(now - back * 86_400_000);
      const doc = await this.deps.kv.get<AnalyticsDayDoc>(analyticsDayKey(day));
      const screens = doc?.screens ?? {};
      const events = { advisorMessages: 0, pbUnlocks: 0, newsReads: 0, ...doc?.events };
      const views = Object.values(screens).reduce((sum, count) => sum + count, 0);
      out.push({ day, visitors: Array.isArray(doc?.visitors) ? doc.visitors.length : 0, views, screens, events });
    }
    return { days: out };
  }
}
