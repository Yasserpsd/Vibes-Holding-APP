import type { FastifyBaseLogger } from 'fastify';

import type { PushService } from '../push/service.js';
import { lastRiyadhDays, riyadhDay, riyadhDayStart } from '../riyadh.js';
import type { KV } from '../store.js';
import type { AppStoreClient } from './appStore.js';
import type { PlayStoreClient } from './playStore.js';

/**
 * M158 (owner, 2026-10-30: «أعرف كام عميل حمّل التطبيق… أول لما أفتح… كام هنا وكام هنا والإجمالي»).
 * Two honest layers (M228: never mixed in one number): what the server knows today — signed-in devices and accounts per platform from the
 * push tokens — and, once the store credentials are set on Railway, the stores' own install numbers.
 * One kv document holds a snapshot per Riyadh day so the home card's trend accumulates from the first boot.
 */
export const DAILY_KEY = 'downloads:daily';
const KEEP_DAYS = 400;
/** How far back Google's first installs report is looked for, while no Google day is stored yet. */
const FIRST_FILL_DAYS = 180;
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

/** The numbers of one store. `installs` is null until the store has answered at least once — never a device count. */
export type StoreAnswer = {
  configured: boolean;
  /** Store downloads inside the asked range. */
  installs: number | null;
  /** Store downloads since the first one. */
  allTime: number | null;
  /** The day of the first download the store reported; null when `allTime` reaches back before the stored days (Google's lifetime total). */
  since: string | null;
  /** The last day the store has published a number for. */
  latest: string | null;
  /** Why the store did not answer on the last attempt (the store answer itself, no secrets). */
  error?: string;
};

/**
 * M228 (owner, 2026-11-11: «عايز الرقم الحقيقي لكل اللي حمّلوا حتى لو ما سجّلوش… والأرقام دي للناس اللي سجّلت»).
 * Two units that never mix: `stores` + `installs` are store downloads only; `devices` is who is signed in.
 */
export type DownloadsAnswer = {
  /** Days the store numbers cover (7, 30 or 90). */
  range: number;
  stores: { apple: StoreAnswer; google: StoreAnswer };
  /** Sum of the stores that answered; `complete` only when both did. */
  installs: { total: number | null; allTime: number | null; complete: boolean };
  /** Signed-in devices and accounts per platform (push tokens) — a separate unit, never added to installs. */
  devices: { android: number; ios: number; total: number; accounts: { android: number; ios: number; total: number } };
  /** Store downloads per Riyadh day of the range; null on a day the store has no stored number for (it never stands in as a zero). */
  series: { day: string; android: number | null; ios: number | null }[];
  snapshotAt: string | null;
};

export const RANGES = [7, 30, 90] as const;

/** A store failure as one short line for the dashboard. */
function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 300);
}

type Deps = { kv: KV; push: PushService; log: FastifyBaseLogger; apple?: AppStoreClient; google?: PlayStoreClient };

export class DownloadsService {
  /** The failure of the last attempt per store (cleared by the next success) so the card can say why a number is missing. */
  private readonly errors: { apple?: string; google?: string } = {};

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
    // Old device snapshots leave the document, but never a store number: «منذ الإطلاق» is the sum of the stored days
    // (Apple has no lifetime figure of its own), so a pruned day would quietly lower it.
    const cutoff = riyadhDayStart(today) - KEEP_DAYS * DAY_MS;
    for (const day of Object.keys(doc)) {
      if (riyadhDayStart(day) >= cutoff) continue;
      if (doc[day]!.storeIos === undefined && doc[day]!.storeAndroid === undefined) delete doc[day];
    }
    await this.deps.kv.set(DAILY_KEY, doc);
    return row;
  }

  /**
   * Yesterday's store numbers land today (both stores publish a day late); earlier gaps of the last 30 days are backfilled once.
   * Google's very first report is looked for further back (FIRST_FILL_DAYS), and every day of a month that was read is kept.
   */
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
        delete this.errors.apple;
      } catch (error) {
        this.errors.apple = errorText(error);
        this.deps.log.warn({ err: error }, 'app store installs failed');
      }
    }
    if (this.deps.google) {
      const google = this.deps.google;
      try {
        // M230: Google can write its first file weeks after the first install (the Play Console had numbers long before
        // any report existed). Until one Google day is stored, the months are asked from further back, and every day of
        // a month that was read is kept (never today's), so the days of the launch are not lost to the 30-day window.
        const started = Object.values(doc).some((row) => row.storeAndroid !== undefined);
        const span = started ? days : lastRiyadhDays(FIRST_FILL_DAYS + 1, now).slice(0, FIRST_FILL_DAYS);
        const months = Array.from(new Set(span.map((day) => day.slice(0, 7).replace('-', ''))));
        const yesterday = days[days.length - 1]!;
        let found = 0;
        for (const month of months) {
          const rows = await google.month(month);
          if (!rows) continue;
          found += 1;
          for (const entry of rows) {
            if (entry.day > yesterday) continue;
            const base = doc[entry.day] ?? { android: 0, ios: 0 };
            doc[entry.day] = { ...base, storeAndroid: entry.installs, ...(entry.total !== null ? { playTotal: entry.total } : {}) };
          }
        }
        const latest = doc[riyadhDay(now)];
        if (latest) Object.assign(today, { storeAndroid: latest.storeAndroid, playTotal: latest.playTotal });
        if (found) {
          delete this.errors.google;
        } else {
          // Every month answered 404: say whether the folder is empty or holds the files of another package.
          const names = (await google.list()).map((name) => name.replace(/^stats\/installs\//, ''));
          this.errors.google = `no installs report for months ${months.join(', ')}; the installs folder holds ${names.length} files${names.length ? `: ${names.slice(0, 4).join(', ')}` : ''}`.slice(0, 300);
          this.deps.log.warn({ months, files: names.length }, 'google play installs report not found');
        }
      } catch (error) {
        this.errors.google = errorText(error);
        this.deps.log.warn({ err: error }, 'google play installs failed');
      }
    }
  }

  /** The home card: store downloads per store for the range and since the first one, and the signed-in devices beside them. */
  async read(now = Date.now(), range = 30): Promise<DownloadsAnswer> {
    const doc = await this.load();
    const platforms = await this.deps.push.platforms();
    const days = lastRiyadhDays(range, now);
    const known = Object.keys(doc).sort();
    const devices = {
      android: platforms.devices.android,
      ios: platforms.devices.ios,
      total: platforms.devices.android + platforms.devices.ios,
      accounts: { android: platforms.accounts.android, ios: platforms.accounts.ios, total: platforms.accounts.total },
    };
    const store = (configured: boolean, pick: (row: DailyRow) => number | undefined, error: string | undefined): StoreAnswer => {
      let allTime: number | null = null;
      let since: string | null = null;
      let latest: string | null = null;
      for (const day of known) {
        const value = pick(doc[day]!);
        if (value === undefined) continue;
        allTime = (allTime ?? 0) + value;
        latest = day;
        if (value > 0) since ??= day;
      }
      const installs = allTime === null ? null : days.reduce((sum, day) => sum + (doc[day] ? (pick(doc[day]!) ?? 0) : 0), 0);
      return { configured, installs, allTime, since, latest, ...(error ? { error } : {}) };
    };
    const apple = store(Boolean(this.deps.apple), (row) => row.storeIos, this.errors.apple);
    const google = store(Boolean(this.deps.google), (row) => row.storeAndroid, this.errors.google);
    // The lifetime total Google reports beats the sum of the days we happened to store. Those days then no longer account
    // for the whole figure, so it has no start day among them (M230: the card says «منذ الإطلاق» instead of dating a lifetime number).
    const playTotal = [...known].reverse().map((day) => doc[day]!.playTotal).find((value) => value !== undefined);
    if (playTotal !== undefined && google.allTime !== null && playTotal > google.allTime) {
      google.allTime = playTotal;
      google.since = null;
    }
    const answered = [apple, google].filter((entry) => entry.installs !== null);
    const add = (pick: (entry: StoreAnswer) => number | null): number | null => (answered.length ? answered.reduce((sum, entry) => sum + (pick(entry) ?? 0), 0) : null);
    return {
      range,
      stores: { apple, google },
      installs: { total: add((entry) => entry.installs), allTime: add((entry) => entry.allTime), complete: answered.length === 2 },
      devices,
      // M230: a day the store has no number for (not published yet, before its first stored day, a store that never
      // answered) is null, never a zero: the card draws only the days that exist.
      series: days.map((day) => ({ day, android: doc[day]?.storeAndroid ?? null, ios: doc[day]?.storeIos ?? null })),
      snapshotAt: known.length ? known[known.length - 1]! : null,
    };
  }
}
