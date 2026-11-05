import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse } from './auth/guard.js';
import type { AuthService } from './auth/service.js';
import { langOf } from './lang.js';
import { APP_STORE_URL, PLAY_STORE_URL } from './legal/applink.js';
import type { KV } from './store.js';

/**
 * M195 (owner, 2026-11-04: «أي شخص غير محدث التطبيق اجبره يطلع رسالة إن يرجى التحديث عشان يشتغل معاه التطبيق»):
 * the minimum binary version the app must run. The app sends `x-app-version` on every request; an older
 * binary gets 426 `update_required` on every `/api/*` call (the bundle shows the forced-update cover, and
 * older bundles show the Arabic message as their error text), and `GET /api/app/status` tells a fresh
 * launch at once. The floor comes from the dashboard (kv `app:minVersion`) or the MIN_APP_VERSION variable;
 * falls back to STORE_APP_VERSION (the binary in the stores). `APP_REQUIRE_VERSION` (default 1) also blocks app requests that carry no version header
 * (bundles older than M195 — only the ones that already send `x-app-platform`, so the dashboard is never hit).
 * M200 (owner, 2026-11-05: «الغي الشرط ده فورا» — store phones stuck on an older bundle were told to update a build
 * that was already the latest, and deleted the app): the gate is OFF unless APP_VERSION_GATE=1; off = no 426, status never asks.
 */
export const MIN_VERSION_KEY = 'app:minVersion';
/**
 * The binary in the stores today (owner, 2026-11-04: «أي حد معاه نسخة أقدم من اللي في المتجر متفتحتش أصلًا»):
 * the floor when neither the dashboard nor MIN_APP_VERSION says otherwise. BUMP IT with every store release
 * (app/app.config.ts `version`) — a value above the store's would lock everybody out.
 */
export const STORE_APP_VERSION = '1.3.0';
const VERSION = /^\d+(\.\d+){0,3}$/;

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number(part) || 0);
  const right = b.split('.').map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function header(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value ? value : null;
}

/** The binary version the app declared (M195 bundles and later), or null. */
export function appVersionOf(request: FastifyRequest): string | null {
  const value = header(request, 'x-app-version');
  return value && VERSION.test(value) ? value : null;
}

export function updateRequiredMessage(lang: 'ar' | 'en'): string {
  return lang === 'en'
    ? 'This version of the app is out of date and no longer works. Please update Investors Club from the store.'
    : 'هذا الإصدار من التطبيق قديم ولم يعد يعمل. يرجى تحديث تطبيق Investors Club من المتجر.';
}

export type AppVersionOptions = {
  kv: KV;
  auth: AuthService;
  /** MIN_APP_VERSION from the environment; the dashboard's value wins when set. */
  envMinVersion: string;
  /** APP_REQUIRE_VERSION=1: an app request without the header is treated as too old. */
  requireHeader: boolean;
  /** APP_VERSION_GATE=1; anything else leaves every app version working (M200). */
  enabled: boolean;
};

/** Paths every bundle may call however old: the status itself and the owner's wording. */
const EXEMPT = ['/api/app/status', '/api/strings', '/api/health'];

type FloorReader = { read: () => Promise<string>; forget: () => void };
const readers = new WeakMap<KV, FloorReader>();

/** The floor as the kv (dashboard) or the environment sets it, cached half a minute — ONE reader per store, so the dashboard's save reaches the gate at once. */
function minVersionReader(kv: KV, envMinVersion: string): FloorReader {
  const existing = readers.get(kv);
  if (existing) return existing;
  let cached: { value: string; at: number } | null = null;
  const reader: FloorReader = {
    async read() {
      if (cached && Date.now() - cached.at < 30_000) return cached.value;
      const stored = (await kv.get<{ minVersion: string }>(MIN_VERSION_KEY))?.minVersion?.trim() ?? '';
      const value = VERSION.test(stored) ? stored : VERSION.test(envMinVersion) ? envMinVersion : STORE_APP_VERSION;
      cached = { value, at: Date.now() };
      return value;
    },
    forget() {
      cached = null;
    },
  };
  readers.set(kv, reader);
  return reader;
}

function tooOld(version: string | null, floor: string, requireHeader: boolean): boolean {
  if (!floor) return false;
  if (version) return compareVersions(version, floor) < 0;
  return requireHeader;
}

/**
 * The gate itself, installed on the ROOT instance (a hook added inside a registered plugin would only
 * cover that plugin's own routes): every app request below the floor is answered 426 at once.
 */
export function installAppVersionGate(app: FastifyInstance, { kv, envMinVersion, requireHeader, enabled }: Omit<AppVersionOptions, 'auth'>): void {
  if (!enabled) return;
  const floorOf = minVersionReader(kv, envMinVersion);
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || EXEMPT.includes(path) || path.startsWith('/api/admin/')) return;
    // Only the app sends the platform header (M146): the dashboard and plain probes are never judged.
    if (!header(request, 'x-app-platform')) return;
    const floor = await floorOf.read();
    if (!tooOld(appVersionOf(request), floor, requireHeader)) return;
    await reply.code(426).send({ error: { code: 'update_required', message: updateRequiredMessage(langOf(request)), minVersion: floor } });
  });
}

export const appVersionRoutes: FastifyPluginAsync<AppVersionOptions> = async (app, { kv, auth, envMinVersion, requireHeader, enabled }) => {
  const requireAdmin = dashboardGuard(auth);
  const floorOf = minVersionReader(kv, envMinVersion);
  const minVersion = floorOf.read;

  app.get('/api/app/status', async (request) => {
    const floor = await minVersion();
    const query = (request.query ?? {}) as Record<string, unknown>;
    const version = typeof query.version === 'string' && VERSION.test(query.version) ? query.version : appVersionOf(request);
    return {
      minVersion: floor,
      updateRequired: enabled && tooOld(version, floor, requireHeader),
      message: updateRequiredMessage(langOf(request)),
      storeUrls: { ios: APP_STORE_URL, android: PLAY_STORE_URL },
    };
  });

  app.get(
    '/api/admin/app/min-version',
    guard(async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const stored = (await kv.get<{ minVersion: string }>(MIN_VERSION_KEY))?.minVersion ?? '';
      return { minVersion: await minVersion(), stored, envMinVersion, requireHeader, enabled };
    }),
  );

  const minVersionSchema = z.object({ minVersion: z.string().trim().regex(/^(\d+(\.\d+){0,3})?$/, 'اكتب رقم الإصدار مثل 1.3.0 أو اتركه فارغًا') });
  app.put(
    '/api/admin/app/min-version',
    guard(async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const input = parse(minVersionSchema, request.body, reply);
      if (!input) return;
      await kv.set(MIN_VERSION_KEY, { minVersion: input.minVersion });
      floorOf.forget();
      return { minVersion: await minVersion() };
    }),
  );
};
