import type { FastifyBaseLogger } from 'fastify';

import type { PushService } from '../push/service.js';
import { lastRiyadhDays, riyadhDay, riyadhDayStart } from '../riyadh.js';
import type { KV } from '../store.js';
import type { AppStoreClient } from './appStore.js';
import type { PlayStoreClient } from './playStore.js';

/**
 * M158 (owner, 2026-10-30: «أعرف كام عميل حمّل التطبيق… أول لما أفتح… كام هنا وكام هنا والإجمالي»).
 * Two honest layers: what the server knows today — signed-in devices and accounts per platform from the
 * push tokens — and, once the store credentials are set on Railway, the stores' own install numbers.
 * One kv document holds a snapshot per Riyadh day so the home card's trend accumulates from the first boot.
 */
export const DAILY_KEY = 'downloads:daily';
const KEEP_DAYS = 400;
const DAY_MS = 86_400_000;

export type DailyRow = {
  /** Signed-in devices per platform at snapshot time (push tokens). */
  android: number;
  ios: number;
  /** Store installs ON that day, when the store clients are configured. */
  storeAndroid?: number;
  storeIos?: number;
  /** Google's lifetime «Total User Installs» as of that day. */
  playTotal?: number;
};
export type DailyDoc = Record<string, DailyRow>;

export type DownloadsAnswer = {
  /** `stores` once at least one store client is configured and answered; else `devices`. */
  mode: 'devices' | 'stores';
  android: number;
  ios: number;
  total: number;
  devices: { android: number; ios: number; total: number; accounts: { android: number; ios: number; total: number } };
  stores: {
    apple: { configured: boolean; installs: number | null; since: string | null; error?: string };
    google: { configured: boolean; installs: number | null; since: string | null; error?: string };
  };
  /** Last 30 Riyadh days: signed-in devices per platform (devices mode) or the stores' installs on that day (stores mode). */
  series: { day: string; android: number; ios: number }[];
  snapshotAt: string | null;
};

type Deps = { kv: KV; push: PushService; log: FastifyBaseLogger; apple?: AppStoreClient; google?: PlayStoreClient };

export class DownloadsService {
  constructor(private readonly deps: Deps) {}

  get configured(): { apple: boolean; google: boolean } {
    return { apple: Boolean(this.deps.apple), google: Boolean(this.deps.google) };
  }

  private async load(): Promise<DailyDoc> {
    return (await this.deps.kv.get<DailyDoc>(DAILY_KEY)) ?? {};
  }

  /** Today's row (device counts always, store installs when configured), kept beside the earlier days. */
  async snapshot(now = Date.now()): Promise<DailyRow> {
    const doc = await this.load();
    const today = riyadhDay(now);
    const platforms = await this.deps.push.platforms();
    const row: DailyRow = { ...doc[today], android: platforms.devices.android, ios: platforms.devices.ios };
    await this.fillStores(doc, row, now);
    doc[today] = row;
    const cutoff = riyadhDayStart(today) - KEEP_DAYS * DAY_MS;
    for (const day of Object.keys(doc)) if (riyadhDayStart(day) < cutoff) delete doc[day];
    await this.deps.kv.set(DAILY_KEY, doc);
    return row;
  }

  /** Yesterday's store numbers land today (both stores publish a day late); earlier gaps of the last 30 days are backfilled once. */
  private async fillStores(doc: DailyDoc, today: DailyRow, now: number): Promise<void> {
    const days = lastRiyadhDays(31, now).slice(0, 30);
    // Apple writes a day's report by the next Pacific morning (≈ 16:00 Riyadh): from two Riyadh days later a 404
    // means «no sales that day», so the day settles as 0 instead of being asked again every 6 hours.
    const settledBefore = days[days.length - 1]!;
    if (this.deps.apple) {
      const apple = this.deps.apple;
      try {
        for (const day of days) {
          if (doc[day]?.storeIos !== undefined) continue;
          const installs = await apple.installsOn(day);
          if (installs === null && day >= settledBefore) continue;
          doc[day] = { ...(doc[day] ?? { android: 0, ios: 0 }), storeIos: installs ?? 0 };
        }
        today.storeIos = doc[riyadhDay(now)]?.storeIos ?? today.storeIos;
      } catch (error) {
        this.deps.log.warn({ err: error }, 'app store installs failed');
      }
    }
    if (this.deps.google) {
      const google = this.deps.google;
      try {
        const months = Array.from(new Set(days.map((day) => day.slice(0, 7).replace('-', ''))));
        for (const month of months) {
          const rows = await google.month(month);
          if (!rows) continue;
          for (const entry of rows) {
            if (!days.includes(entry.day)) continue;
            const base = doc[entry.day] ?? { android: 0, ios: 0 };
            doc[entry.day] = { ...base, storeAndroid: entry.installs, ...(entry.total !== null ? { playTotal: entry.total } : {}) };
          }
        }
        const latest = doc[riyadhDay(now)];
        if (latest) Object.assign(today, { storeAndroid: latest.storeAndroid, playTotal: latest.playTotal });
      } catch (error) {
        this.deps.log.warn({ err: error }, 'google play installs failed');
      }
    }
  }

  /** The home card's answer: today's counts, the store totals when known, and the 30-day series. */
  async read(now = Date.now()): Promise<DownloadsAnswer> {
    const doc = await this.load();
    const platforms = await this.deps.push.platforms();
    const days = lastRiyadhDays(30, now);
    const known = Object.keys(doc).sort();
    const devices = {
      android: platforms.devices.android,
      ios: platforms.devices.ios,
      total: platforms.devices.android + platforms.devices.ios,
      accounts: { android: platforms.accounts.android, ios: platforms.accounts.ios, total: platforms.accounts.total },
    };
    const sum = (pick: (row: DailyRow) => number | undefined): { installs: number | null; since: string | null } => {
      let installs: number | null = null;
      let since: string | null = null;
      for (const day of known) {
        const value = pick(doc[day]!);
        if (value === undefined) continue;
        installs = (installs ?? 0) + value;
        since ??= day;
      }
      return { installs, since };
    };
    const appleSum = sum((row) => row.storeIos);
    const googleSum = sum((row) => row.storeAndroid);
    // Google's own lifetime total beats the sum of the days we happened to store.
    const playTotal = [...known].reverse().map((day) => doc[day]!.playTotal).find((value) => value !== undefined);
    const google = { configured: Boolean(this.deps.google), installs: playTotal ?? googleSum.installs, since: playTotal !== undefined ? null : googleSum.since };
    const apple = { configured: Boolean(this.deps.apple), installs: appleSum.installs, since: appleSum.since };
    const storesMode = apple.installs !== null || google.installs !== null;
    const today = riyadhDay(now);
    let series: DownloadsAnswer['series'];
    if (storesMode) {
      // Stores mode: the stores' own installs per day (a day a store has not written yet counts 0 for it).
      series = days.map((day) => ({ day, android: doc[day]?.storeAndroid ?? 0, ios: doc[day]?.storeIos ?? 0 }));
    } else {
      // Devices mode: the trend carries the device counts; a day without a snapshot repeats the last known one so the line never drops to zero.
      let last: { android: number; ios: number } = { android: 0, ios: 0 };
      series = days.map((day) => {
        const row = doc[day];
        if (row) last = { android: row.android, ios: row.ios };
        return { day, ...last };
      });
      if (series.length) series[series.length - 1] = { day: today, android: devices.android, ios: devices.ios };
    }
    // A store that has not answered yet keeps its device count (the card captions each column by what it holds).
    const android = storesMode ? (google.installs ?? devices.android) : devices.android;
    const ios = storesMode ? (apple.installs ?? devices.ios) : devices.ios;
    return {
      mode: storesMode ? 'stores' : 'devices',
      android,
      ios,
      total: android + ios,
      devices,
      stores: { apple, google },
      series,
      snapshotAt: known.length ? known[known.length - 1]! : null,
    };
  }
}
