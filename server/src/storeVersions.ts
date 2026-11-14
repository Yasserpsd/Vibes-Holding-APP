import type { FastifyBaseLogger } from 'fastify';

import type { KV } from './store.js';

/**
 * M239 (owner, 2026-11-14: «مع كل build اعملها قاعدة… نلغي اللي قبله… واتأكد إنها تطلع في النسخة القديمة فقط»):
 * the version that is really LIVE in each store, read from the store itself — never from what we built or
 * submitted. A new build becomes that platform's forced-update floor by itself, but only when ALL of this holds:
 *   1. the store has shown it without a break for the whole grace period (review, store caches);
 *   2. phones of that platform are really running it (`reach`: a fair share of launches prove that binary) —
 *      a store page can run ahead of a staged rollout, the fleet cannot;
 *   3. it does not ask for a newer operating system than the build before it (those phones could never update;
 *      the owner decides that one himself).
 * Nobody is ever told to update to something their store does not give them. A failed or unreadable lookup
 * changes nothing, and a version withdrawn from a store pulls the floor back with it.
 */
export type StorePlatform = 'ios' | 'android';

const KEY = 'app:storeVersions';
const VERSION = /^\d+(\.\d+){1,3}$/;
const TIMEOUT_MS = 12_000;
const HOUR_MS = 3_600_000;
/** Lookups run hourly: a longer silence means nobody was looking, and the grace clock starts again. */
const WATCH_GAP_MS = 3 * HOUR_MS;
/** A store unread for this long no longer holds a raised floor: what it offers now is unknown. */
const BLIND_MS = 72 * HOUR_MS;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

type Listing = { version: string; /** The lowest OS the build runs on (iOS version / Android API level); null when unread. */ minOs: string | null };

type PlatformState = {
  /** The version the store showed at the last successful lookup. */
  live: string;
  /** Since when the store has shown `live` WITHOUT a break (ISO). */
  since: string;
  /** The version taken as already out when the watch began: it retires nobody by itself. */
  initial: string;
  /** The newest version that has been live for the whole grace period: the most a typed floor may ask for. */
  settled: string;
  /** The automatic floor reached so far (never drops by itself, but never applies above `live`). */
  floor?: string;
  /** The minimum OS of `live`, and of the build the floor (or the start of the watch) stands on. */
  liveMinOs: string | null;
  floorMinOs: string | null;
  /** Why `live` is not the floor yet: `grace`, `reach`, `min-os` — null when it is, or when it retires nobody. */
  waiting: 'grace' | 'reach' | 'min-os' | null;
  checkedAt: string;
  /** Since when the store could not be read (ISO); absent while lookups succeed. */
  failedSince?: string;
};
type State = Partial<Record<StorePlatform, PlatformState>>;

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number(part) || 0);
  const right = b.split('.').map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

const lower = (a: string, b: string): string => (compareVersions(a, b) <= 0 ? a : b);

/** The App Store's public lookup: `results[0].version` and `minimumOsVersion`. */
export function parseAppStore(body: unknown): Listing | null {
  const results = (body as { results?: { version?: unknown; minimumOsVersion?: unknown }[] } | null)?.results;
  const first = Array.isArray(results) ? results[0] : null;
  const version = typeof first?.version === 'string' ? first.version.trim() : '';
  if (!VERSION.test(version)) return null;
  const minOs = typeof first?.minimumOsVersion === 'string' && /^\d+(\.\d+){0,2}$/.test(first.minimumOsVersion.trim()) ? first.minimumOsVersion.trim() : null;
  return { version, minOs };
}

/**
 * The Play listing page carries the version under its own key: `"141":[[["1.3.2"]],[[[36]],[[[24,"7.0"]]]]]`
 * (version, target API level, minimum API level). Only that exact shape is read: «Varies with device» or a
 * changed page gives nothing, and nothing changes.
 */
export function parsePlayStore(html: string): Listing | null {
  const match = /"141":\[\[\["(\d+(?:\.\d+){1,3})"\]\],\[\[\[\d+\]\](?:,\[\[\[(\d+),"[\d.]+"\]\]\])?/u.exec(html);
  if (!match?.[1]) return null;
  return { version: match[1], minOs: match[2] ?? null };
}

export type StoreVersionsOptions = {
  kv: KV;
  log: Pick<FastifyBaseLogger, 'warn' | 'info'>;
  /** The production app id in both stores. */
  appId: string;
  /** Hours a version must have been live in the store, without a break, before it may retire the older ones. */
  graceHours: number;
  /** Nothing below this is ever the automatic floor. */
  baseline: string;
  /** The version known to be in both stores when the code was written: a first sight above it is a new release, not the start. */
  known: string;
  /** The minimum OS of the `known` binaries (iOS version / Android API level): the reference when the first sight is already above `known`. */
  knownMinOs?: Partial<Record<StorePlatform, string>>;
  /** Are phones of that platform really running that version (or newer)? Asked only once the grace period is over. */
  reach: (platform: StorePlatform, version: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
};

export class StoreVersions {
  private state: State | null = null;
  private warned = new Set<string>();

  constructor(private readonly options: StoreVersionsOptions) {}

  private async load(): Promise<State> {
    if (!this.state) this.state = (await this.options.kv.get<State>(KEY)) ?? {};
    return this.state;
  }

  private async lookup(platform: StorePlatform): Promise<Listing | null> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const id = encodeURIComponent(this.options.appId);
    if (platform === 'ios') {
      const response = await fetchImpl(`https://itunes.apple.com/lookup?bundleId=${id}&country=sa`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`App Store lookup HTTP ${response.status}`);
      return parseAppStore(await response.json());
    }
    const response = await fetchImpl(`https://play.google.com/store/apps/details?id=${id}&hl=en&gl=sa`, {
      headers: { 'user-agent': BROWSER_UA, cookie: 'CONSENT=YES+1' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Play listing HTTP ${response.status}`);
    return parsePlayStore(await response.text());
  }

  /** Asks both stores and settles each platform's floor; whatever fails leaves that platform exactly as it was. */
  async refresh(now = Date.now()): Promise<void> {
    const state = await this.load();
    const stamp = new Date(now).toISOString();
    for (const platform of ['ios', 'android'] as const) {
      const listing = await this.lookup(platform).catch((error: unknown) => {
        this.options.log.warn({ err: error, platform }, 'store version lookup failed; the floor stays as it was');
        return null;
      });
      const current = state[platform];
      if (!listing) {
        if (current && !current.failedSince) current.failedSince = stamp;
        if (!this.warned.has(platform)) {
          this.warned.add(platform);
          this.options.log.warn({ platform, everRead: Boolean(current) }, 'store version could not be read; the floor of that platform does not move');
        }
        continue;
      }
      this.warned.delete(platform);
      if (!current) {
        // A first sight above the version the code knows is a release under way, not the starting point — so its
        // own minimum OS is not the reference either: the known build's is (unknown = the floor waits for the owner).
        const ahead = compareVersions(listing.version, this.options.known) > 0;
        const initial = ahead ? this.options.known : listing.version;
        state[platform] = { live: listing.version, since: stamp, initial, settled: initial, liveMinOs: listing.minOs, floorMinOs: ahead ? (this.options.knownMinOs?.[platform] ?? null) : listing.minOs, waiting: null, checkedAt: stamp };
        this.options.log.info({ platform, live: listing.version }, 'store version watch started');
      } else {
        // The grace clock counts time WITHOUT a break, and only time somebody was looking: a version that left the
        // store and came back starts again, and so does one seen again after a silence (failed lookups, the watch off).
        if (current.live !== listing.version || now - Date.parse(current.checkedAt) > WATCH_GAP_MS) {
          if (current.live !== listing.version) this.options.log.info({ platform, from: current.live, to: listing.version }, 'store version changed');
          current.live = listing.version;
          current.since = stamp;
        }
        current.liveMinOs = listing.minOs;
        current.checkedAt = stamp;
        delete current.failedSince;
      }
      await this.settle(platform, state[platform] as PlatformState, now);
    }
    await this.options.kv.set(KEY, state);
  }

  /** Decides whether `live` is the floor now, and records why not when it is not. */
  private async settle(platform: StorePlatform, current: PlatformState, now: number): Promise<void> {
    const { baseline, graceHours } = this.options;
    // A version withdrawn from the store takes the floor back with it; its return earns the floor again from zero.
    if (current.floor && compareVersions(current.floor, current.live) > 0) current.floor = compareVersions(current.live, baseline) > 0 ? current.live : undefined;
    const floor = current.floor ?? baseline;
    // The build the floor stands on had no readable requirement when the watch began: take it once it is known.
    if (!current.floorMinOs && current.liveMinOs && compareVersions(current.live, current.floor ?? current.initial) <= 0) current.floorMinOs = current.liveMinOs;
    const graced = now - Date.parse(current.since) >= graceHours * HOUR_MS;
    if (graced && compareVersions(current.live, current.settled) > 0) current.settled = current.live;
    // A withdrawn version takes `settled` back with it.
    if (compareVersions(current.settled, current.live) > 0) current.settled = current.live;
    const was = current.waiting;
    current.waiting = null;
    if (compareVersions(current.live, current.initial) <= 0 || compareVersions(current.live, floor) <= 0) return;
    if (!graced) {
      current.waiting = 'grace';
      return;
    }
    // A build that needs a newer OS (or whose requirement could not be read) never retires the older ones by itself.
    if (!current.liveMinOs || !current.floorMinOs || compareVersions(current.liveMinOs, current.floorMinOs) > 0) {
      if (was !== 'min-os') this.options.log.warn({ platform, live: current.live, minOs: current.liveMinOs, was: current.floorMinOs }, 'the new build asks for a newer OS: the floor waits for the owner');
      current.waiting = 'min-os';
      return;
    }
    const reached = await this.options.reach(platform, current.live).catch(() => false);
    if (!reached) {
      current.waiting = 'reach';
      return;
    }
    current.floor = current.live;
    current.floorMinOs = current.liveMinOs;
    this.options.log.info({ platform, floor: current.live }, 'forced-update floor raised: the new store version retires the older ones');
  }

  /** The version live in that store at the last successful lookup, or null when it was never read. */
  async live(platform: StorePlatform): Promise<string | null> {
    return (await this.load())[platform]?.live ?? null;
  }

  /** The most a typed floor may ask for: the newest version that has been live for the whole grace period. */
  async settled(platform: StorePlatform): Promise<string | null> {
    const current = (await this.load())[platform];
    return current ? lower(current.settled, current.live) : null;
  }

  /**
   * The owner accepts a build that asks for a newer OS (he typed a floor that covers it): from here on that
   * build's requirement is the reference, and the builds after it follow the automatic rule again.
   */
  async acceptMinOs(platform: StorePlatform, typedFloor: string): Promise<void> {
    const state = await this.load();
    const current = state[platform];
    if (!current || current.waiting !== 'min-os' || !current.liveMinOs || compareVersions(typedFloor, current.live) < 0) return;
    current.floorMinOs = current.liveMinOs;
    await this.options.kv.set(KEY, state);
    this.options.log.info({ platform, live: current.live, minOs: current.liveMinOs }, 'the owner accepted the newer minimum OS');
  }

  /**
   * The automatic floor of one platform — never above what the store shows now, never below the baseline unless
   * the store itself is, and back to the baseline while the store has been unreadable for days (a version may
   * have been withdrawn unseen; a missed old phone is the acceptable side).
   */
  async floor(platform: StorePlatform, now = Date.now()): Promise<string> {
    const { baseline } = this.options;
    const current = (await this.load())[platform];
    if (!current) return baseline;
    if (current.failedSince && now - Date.parse(current.failedSince) > BLIND_MS) return lower(baseline, current.live);
    return lower(current.floor ?? baseline, current.live);
  }

  async snapshot(): Promise<Record<StorePlatform, (PlatformState & { effectiveFloor: string }) | null>> {
    const state = await this.load();
    const of = async (platform: StorePlatform) => (state[platform] ? { ...(state[platform] as PlatformState), effectiveFloor: await this.floor(platform) } : null);
    return { ios: await of('ios'), android: await of('android') };
  }
}
