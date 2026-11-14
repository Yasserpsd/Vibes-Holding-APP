import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { VersionStats } from './appVersionStats.js';
import { dashboardGuard, guard, parse } from './auth/guard.js';
import type { AuthService } from './auth/service.js';
import { langOf } from './lang.js';
import { APP_STORE_URL, PLAY_STORE_URL } from './legal/applink.js';
import type { KV } from './store.js';
import { compareVersions, type StorePlatform, type StoreVersions } from './storeVersions.js';

export { compareVersions };

/**
 * M195 (owner, 2026-11-04: «أي شخص غير محدث التطبيق اجبره يطلع رسالة إن يرجى التحديث عشان يشتغل معاه التطبيق»):
 * the minimum binary version the app must run. A binary below the floor gets 426 `update_required` on every
 * `/api/*` call (the bundle shows the forced-update cover; bundles older than M195 show the message as their
 * error text), and `GET /api/app/status` tells a fresh launch at once.
 * M200 (owner, 2026-11-05: «الغي الشرط ده فورا»): store phones still on a pre-M195 bundle sent no version, were
 * treated as too old, and people on the LATEST build were told to update and deleted the app. The gate went off.
 * M239 (owner, 2026-11-14: «أي حد عنده نسخة قبل 1.3.0 لازم يعمل ابديت… واتأكد إنها تطلع في النسخة القديمة فقط…
 * ميبقاش حد عنده نسخة جديدة ويطلعه ايرور»): the gate is back, and it judges on PROOF only —
 *   1. `x-app-binary`: the installed binary's own version, read natively (expo-updates runtime version), so an
 *      OTA bundle can no longer make an old binary look new;
 *   2. an iPhone's own network signature (`…/<build> CFNetwork/…`): the store build number, for bundles too old
 *      to send anything — and a build number above the table is a newer binary, never judged by anything less;
 *   3. `x-app-version`: the version the running bundle was published with — proof only when it is below 1.3.0
 *      (BUNDLE_PROOF_CEILING): an older tree can be published onto any newer binary, so from 1.3.0 on a bundle's
 *      own number says nothing and the binary must name itself.
 * A request that proves nothing is NEVER judged: no header, no block; and when the floor itself cannot be read
 * the request passes. The floor is per platform — the owner's baseline, then whatever version is really live in
 * that store and really running on its phones (storeVersions.ts). A floor typed by the owner can only RAISE it,
 * and never beyond a version the store has offered for the whole grace period. `APP_VERSION_GATE=0` switches
 * the whole gate off.
 */
/** A NEW key: whatever the M195 gate left under `app:minVersion` (or in MIN_APP_VERSION) can never wake up. */
export const FLOOR_OVERRIDE_KEY = 'app:floorOverride';
/** Owner, 2026-11-14: nothing older than this opens. The floor never goes below it. */
export const BASELINE_FLOOR = '1.3.0';
/**
 * The binary in both stores when this file was last touched: the ceiling of a typed floor while the stores
 * themselves could not be read, and the starting point of the store watch.
 */
export const STORE_APP_VERSION = '1.3.2';
/** What the STORE_APP_VERSION binaries ask for: iOS version / Android API level (read from both stores, 2026-11-14). */
export const STORE_MIN_OS = { ios: '16.4', android: '24' } as const;
/**
 * The App Store build numbers (EAS remote auto-increment) of every iOS binary up to STORE_APP_VERSION, as
 * `[highest build, version]`. Only for bundles too old to name their binary: later builds send `x-app-binary`.
 */
const IOS_BUILDS: readonly (readonly [number, string])[] = [
  [3, '1.1.0'],
  [4, '1.2.0'],
  [8, '1.3.0'],
  [10, '1.3.1'],
  [11, '1.3.2'],
];
const IOS_APP_UA = /\/(\d{1,6}) CFNetwork\//u;
/** The only iOS binaries whose bundles may not name their platform (1.1.0, 1.2.0): the header-less path stops there. */
const HEADERLESS_IOS_MAX_BUILD = 4;
/**
 * A bundle's own number (`x-app-version`) proves an old binary only below this. Trees before M239 have no
 * runtime guard in app.config.ts, so one published from an older checkout can sit on ANY newer binary (a
 * rollback, a hot fix): its number says nothing about binaries from 1.3.0 on. Those name themselves with
 * `x-app-binary` once the M239 bundle reaches them. NEVER raise this.
 */
const BUNDLE_PROOF_CEILING = '1.3.0';
/** Proof has the shape of a real version: two to four short parts, and not the client's «unknown» 0.0.0. */
const PROOF = /^\d{1,4}(\.\d{1,4}){1,3}$/;

function header(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value ? value : null;
}

function proofOf(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return PROOF.test(text) && compareVersions(text, '0') > 0 ? text : null;
}

/** The version the running BUNDLE was published with (M195 bundles and later), or null. */
export function appVersionOf(request: FastifyRequest): string | null {
  return proofOf(header(request, 'x-app-version'));
}

/** The store build number an iPhone's own network stack puts in its User-Agent, or null. */
function iosBuildOf(request: FastifyRequest): number | null {
  const build = Number(IOS_APP_UA.exec(String(request.headers['user-agent'] ?? ''))?.[1]);
  return Number.isInteger(build) && build > 0 ? build : null;
}

/** Only the app names its platform (M146). An iPhone bundle older than that is still known by its build number. */
function platformOf(request: FastifyRequest): StorePlatform | null {
  const value = header(request, 'x-app-platform')?.toLowerCase();
  if (value === 'ios' || value === 'android') return value;
  const build = value ? null : iosBuildOf(request);
  return build !== null && build <= HEADERLESS_IOS_MAX_BUILD ? 'ios' : null;
}

export type BinaryEvidence = {
  /** `binary` and `ios-build` name the installed binary exactly; `bundle` is the most it can be. */
  source: 'binary' | 'ios-build' | 'bundle';
  version: string;
};

/**
 * What the request PROVES about the installed binary — null when it proves nothing. The status call may also
 * say it in its query (`?binary=&version=`); on any other path a query is just a query.
 */
export function binaryEvidence(request: FastifyRequest, platform: StorePlatform | null = platformOf(request), withQuery = false): BinaryEvidence | null {
  const query = withQuery ? ((request.query ?? {}) as Record<string, unknown>) : {};
  const binary = proofOf(header(request, 'x-app-binary')) ?? proofOf(query.binary);
  if (binary) return { source: 'binary', version: binary };
  if (platform === 'ios') {
    const build = iosBuildOf(request);
    if (build !== null) {
      const known = IOS_BUILDS.find(([highest]) => build <= highest);
      // A build above the table is a NEWER binary than any this code knows: the bundle's number says nothing about it.
      return known ? { source: 'ios-build', version: known[1] } : null;
    }
  }
  const bundle = appVersionOf(request) ?? proofOf(query.version);
  return bundle ? { source: 'bundle', version: bundle } : null;
}

export function updateRequiredMessage(lang: 'ar' | 'en'): string {
  return lang === 'en'
    ? 'This version of the app is out of date and no longer works. Please update Investors Club from the store.'
    : 'هذا الإصدار من التطبيق قديم ولم يعد يعمل. يرجى تحديث تطبيق Investors Club من المتجر.';
}

export type AppVersionOptions = {
  kv: KV;
  auth: AuthService;
  /** APP_VERSION_GATE; off leaves every app version working (M200). */
  enabled: boolean;
  /** The live store versions; absent (tests, local) = the baseline and the typed floor only. */
  stores?: StoreVersions;
  /** The launch counters; one per store when absent. */
  stats?: VersionStats;
  log?: Pick<FastifyBaseLogger, 'warn'>;
};

/**
 * Unset, the gate is ON for the production app and OFF on the test server (its preview builds are older
 * binaries by design); `APP_VERSION_GATE=0` switches it off anywhere (M200), `1` forces it on.
 */
export function appVersionEnabled(config: { APP_VERSION_GATE?: '0' | '1' | undefined; APP_ENV: 'test' | 'production' }): boolean {
  return (config.APP_VERSION_GATE ?? (config.APP_ENV === 'production' ? '1' : '0')) === '1';
}

/** Paths every bundle may call however old: the status itself and the owner's wording. */
const EXEMPT = ['/api/app/status', '/api/strings', '/api/health'];

type Floors = { read: (platform: StorePlatform) => Promise<string>; forget: () => void; stats: VersionStats };
const floors = new WeakMap<KV, Floors>();

const lower = (a: string, b: string): string => (compareVersions(a, b) <= 0 ? a : b);
const higher = (a: string, b: string): string => (compareVersions(a, b) >= 0 ? a : b);

/** Does this evidence PROVE a binary below the floor? A bundle's number only ever proves «below 1.3.0». */
function provesOld(evidence: BinaryEvidence, floor: string): boolean {
  const bar = evidence.source === 'bundle' ? lower(floor, BUNDLE_PROOF_CEILING) : floor;
  return compareVersions(evidence.version, bar) < 0;
}

/** ONE reader per store, so the dashboard's save reaches the gate at once; each platform's floor is cached half a minute. */
function floorsOf(kv: KV, stores?: StoreVersions, stats?: VersionStats): Floors {
  const existing = floors.get(kv);
  if (existing) return existing;
  const cached = new Map<StorePlatform, { value: string; at: number }>();
  const reader: Floors = {
    async read(platform) {
      const hit = cached.get(platform);
      if (hit && Date.now() - hit.at < 30_000) return hit.value;
      const automatic = stores ? await stores.floor(platform) : BASELINE_FLOOR;
      const typed = proofOf((await kv.get<{ minVersion: string }>(FLOOR_OVERRIDE_KEY))?.minVersion);
      // A typed floor only RAISES the automatic one, and never beyond what the store has offered for the whole
      // grace period: above that, people would be sent to a store that has nothing newer for them.
      const ceiling = (await stores?.settled(platform)) ?? STORE_APP_VERSION;
      const value = typed ? higher(automatic, lower(typed, ceiling)) : automatic;
      cached.set(platform, { value, at: Date.now() });
      return value;
    },
    forget() {
      cached.clear();
    },
    stats: stats ?? new VersionStats(kv),
  };
  floors.set(kv, reader);
  return reader;
}

/**
 * The gate itself, installed on the ROOT instance (a hook added inside a registered plugin would only
 * cover that plugin's own routes): an app request that PROVES a binary below the floor is answered 426.
 */
export function installAppVersionGate(app: FastifyInstance, { kv, enabled, stores, stats, log }: Omit<AppVersionOptions, 'auth'>): void {
  if (!enabled) return;
  const floorOf = floorsOf(kv, stores, stats);
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || EXEMPT.includes(path) || path.startsWith('/api/admin/')) return;
    // The dashboard and plain probes name no platform and are never judged.
    const platform = platformOf(request);
    if (!platform) return;
    // M239: no proof, no judgement — a bundle that says nothing about its binary always passes.
    const evidence = binaryEvidence(request, platform);
    if (!evidence) return;
    let floor: string;
    try {
      floor = await floorOf.read(platform);
      if (!provesOld(evidence, floor)) return;
      floorOf.stats.count(platform, evidence, 'blocked', { who: request.ip });
    } catch (error) {
      // A floor that cannot be read stops nobody.
      log?.warn({ err: error }, 'forced-update floor could not be read; the request passes');
      return;
    }
    await reply.code(426).send({ error: { code: 'update_required', message: updateRequiredMessage(langOf(request)), minVersion: floor } });
  });
}

export const appVersionRoutes: FastifyPluginAsync<AppVersionOptions> = async (app, { kv, auth, enabled, stores, stats, log }) => {
  const requireAdmin = dashboardGuard(auth);
  const floorOf = floorsOf(kv, stores, stats);
  const both = async () => ({ ios: await floorOf.read('ios'), android: await floorOf.read('android') });

  app.get('/api/app/status', async (request) => {
    const platform = platformOf(request);
    const evidence = binaryEvidence(request, platform, true);
    const answer = (floor: string, updateRequired: boolean) => ({
      minVersion: floor,
      updateRequired,
      message: updateRequiredMessage(langOf(request)),
      storeUrls: { ios: APP_STORE_URL, android: PLAY_STORE_URL },
    });
    try {
      // Without a platform nobody is judged; the number shown is the lower of the two stores'.
      const floor = platform ? await floorOf.read(platform) : lower(...(Object.values(await both()) as [string, string]));
      const updateRequired = enabled && Boolean(platform && evidence && provesOld(evidence, floor));
      if (enabled) floorOf.stats.count(platform, evidence, updateRequired ? 'old' : 'ok', { who: request.ip });
      return answer(floor, updateRequired);
    } catch (error) {
      log?.warn({ err: error }, 'forced-update floor could not be read; the status asks for nothing');
      return answer(BASELINE_FLOOR, false);
    }
  });

  const overview = async () => {
    const now = await both();
    const reach = async (platform: StorePlatform) => {
      const live = await stores?.live(platform);
      return live ? { version: live, ...(await floorOf.stats.reached(platform, live)) } : null;
    };
    return {
      // Kept for older dashboard code: one number — the lower of the two stores' floors.
      minVersion: lower(now.ios, now.android),
      floors: now,
      // The owner's own floor: it can only raise the automatic one. Empty = automatic only.
      typed: (await kv.get<{ minVersion: string }>(FLOOR_OVERRIDE_KEY))?.minVersion ?? '',
      enabled,
      baseline: BASELINE_FLOOR,
      // Per store: what is live, since when, the floor reached, and what the newest version still waits for.
      stores: stores ? await stores.snapshot() : null,
      // How far the version live in each store has reached its phones (the last few days of launches).
      reach: { ios: await reach('ios'), android: await reach('android') },
      // Launches per day: platform, what the phone proved about its binary, and the verdict.
      stats: await floorOf.stats.flush(),
    };
  };

  app.get(
    '/api/admin/app/min-version',
    guard(async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      return overview();
    }),
  );

  const minVersionSchema = z.object({ minVersion: z.string().trim().regex(/^(\d{1,4}(\.\d{1,4}){1,3})?$/, 'اكتب رقم الإصدار مثل 1.3.2 أو اتركه فارغًا') });
  app.put(
    '/api/admin/app/min-version',
    guard(async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const input = parse(minVersionSchema, request.body, reply);
      if (!input) return;
      await kv.set(FLOOR_OVERRIDE_KEY, { minVersion: input.minVersion });
      // The owner's own floor is also his answer to a build that asks for a newer OS (the automatic rule waits for it).
      if (input.minVersion && stores) for (const platform of ['ios', 'android'] as const) await stores.acceptMinOs(platform, input.minVersion);
      floorOf.forget();
      return overview();
    }),
  );
};
