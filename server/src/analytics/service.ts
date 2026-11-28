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
export type EventKey = 'advisorMessages' | 'pbUnlocks' | 'newsReads' | 'appOpens';
export const EVENT_KEYS: readonly EventKey[] = ['advisorMessages', 'pbUnlocks', 'newsReads', 'appOpens'];

/**
 * M285: unique people (members and guests) over rolling windows ending today, and the window before
 * each one — counted from the per-day visitor keys, so a person opening on five days counts once.
 */
export type ActiveUsers = { today: number; week: number; prevWeek: number; month: number; prevMonth: number; period: number };
/** M285: sums over the same rolling windows (screen views, app opens). */
export type WindowSums = { week: number; prevWeek: number; month: number; prevMonth: number };

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

  /**
   * One screens batch from the app. Bad names are dropped quietly; the visitor counts once per day.
   * M285: `opens` = app launches and returns from the background carried by the batch (apps before M285 send none).
   */
  screens(batch: string[], visitor: string, now = Date.now(), opens = 0): void {
    const pending = this.day(now);
    for (const screen of batch) {
      if (!isScreenName(screen)) continue;
      pending.screens.set(screen, (pending.screens.get(screen) ?? 0) + 1);
    }
    if (opens > 0) pending.events.set('appOpens', (pending.events.get('appOpens') ?? 0) + opens);
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
  async overview(days: number, now = Date.now()): Promise<{ days: AnalyticsDay[]; active: ActiveUsers; views: WindowSums; opens: WindowSums }> {
    await this.flush();
    // M285: at least 60 days are read so «this month vs the month before» always has both windows.
    const span = Math.max(days, 60);
    const out: AnalyticsDay[] = [];
    const keys: string[][] = [];
    const viewsByDay: number[] = [];
    const opensByDay: number[] = [];
    for (let back = span - 1; back >= 0; back -= 1) {
      const day = riyadhDay(now - back * 86_400_000);
      const doc = await this.deps.kv.get<AnalyticsDayDoc>(analyticsDayKey(day));
      const screens = doc?.screens ?? {};
      const events = { advisorMessages: 0, pbUnlocks: 0, newsReads: 0, appOpens: 0, ...doc?.events };
      const views = Object.values(screens).reduce((sum, count) => sum + count, 0);
      const visitors = Array.isArray(doc?.visitors) ? doc.visitors : [];
      keys.push(visitors);
      viewsByDay.push(views);
      opensByDay.push(events.appOpens);
      if (back < days) out.push({ day, visitors: visitors.length, views, screens, events });
    }
    // keys[last] is today; a window of n days ending `offset` days ago.
    const unique = (n: number, offset = 0): number => {
      const set = new Set<string>();
      const end = keys.length - offset;
      for (let index = Math.max(0, end - n); index < end; index += 1) for (const key of keys[index] ?? []) set.add(key);
      return set.size;
    };
    const active: ActiveUsers = {
      today: unique(1),
      week: unique(7),
      prevWeek: unique(7, 7),
      month: unique(30),
      prevMonth: unique(30, 30),
      period: unique(days),
    };
    const sums = (series: number[]): WindowSums => {
      const window = (n: number, offset = 0) => series.slice(Math.max(0, series.length - offset - n), series.length - offset).reduce((sum, value) => sum + value, 0);
      return { week: window(7), prevWeek: window(7, 7), month: window(30), prevMonth: window(30, 30) };
    };
    return { days: out, active, views: sums(viewsByDay), opens: sums(opensByDay) };
  }
}
