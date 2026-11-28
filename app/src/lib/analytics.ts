import { apiRequest } from '@/api/client';
import { loadSetting, saveSetting } from '@/lib/deviceStore';

/**
 * M33 (M22): batched screen-view reporting to our own server — aggregates only, no third-party
 * service. A batch carries screen names alone (`(tabs)/news`, `project/[id]`…), never ids or
 * parameters; the server counts views per screen and unique visitors per day and keeps nothing
 * per member.
 *
 * M285: the counts were too low. Now every app open counts — a cold start AND a return from the
 * background after 30 s (the screen on top counts again, and the open is sent as a session) — and
 * a batch that could not be sent (no network, the phone suspended the app mid-request) stays on the
 * device and goes with the next batch instead of being lost. Saved batches older than a day are dropped.
 */
const DEVICE_KEY = 'analytics.device';
const PENDING_KEY = 'analytics.pending';
const FLUSH_MS = 30_000;
const FLUSH_AT = 20;
const MAX_QUEUE = 60;
const MAX_OPENS = 20;
const RESUME_AFTER_MS = 30_000;
const PENDING_TTL_MS = 24 * 60 * 60_000;
const SCREEN_NAME = /^[a-z0-9/\[\]()._-]{1,64}$/i;

type Saved = { screens: string[]; opens: number; at: number };

let queue: string[] = [];
let opens = 0;
let lastScreen = '';
let deviceId: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let sending = false;
let disabled = false;
let restored = false;
let backgroundAt: number | null = null;

async function device(): Promise<string> {
  if (deviceId) return deviceId;
  const stored = await loadSetting(DEVICE_KEY);
  if (stored && /^[A-Za-z0-9-]{8,64}$/.test(stored)) {
    deviceId = stored;
    return stored;
  }
  const fresh = `d${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 8)}`;
  deviceId = fresh;
  void saveSetting(DEVICE_KEY, fresh);
  return fresh;
}

/** A batch the last launch could not send joins this one (once per launch). */
async function restore(): Promise<void> {
  if (restored) return;
  restored = true;
  try {
    const raw = await loadSetting(PENDING_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<Saved>;
    if (typeof saved.at !== 'number' || Date.now() - saved.at > PENDING_TTL_MS) return;
    const screens = Array.isArray(saved.screens) ? saved.screens.filter((screen) => typeof screen === 'string' && SCREEN_NAME.test(screen)) : [];
    queue = [...screens, ...queue].slice(0, MAX_QUEUE);
    opens = Math.min(MAX_OPENS, opens + (typeof saved.opens === 'number' && saved.opens > 0 ? Math.floor(saved.opens) : 0));
  } catch {
    // A broken copy is just dropped.
  }
}

function persist(screens: string[], count: number): Promise<void> {
  const value = screens.length || count ? JSON.stringify({ screens, opens: count, at: Date.now() } satisfies Saved) : null;
  return saveSetting(PENDING_KEY, value).catch(() => undefined);
}

/** One opened screen. Repeats of the screen already on top are not views. */
export function reportScreen(screen: string): void {
  if (disabled || !SCREEN_NAME.test(screen) || screen === lastScreen) return;
  lastScreen = screen;
  if (queue.length >= MAX_QUEUE) return;
  queue.push(screen);
  if (queue.length >= FLUSH_AT) void flushViews();
  else startTimer();
}

/** A cold start: one app open. The first screen arrives through reportScreen. */
export function noteLaunch(): void {
  if (disabled) return;
  opens = Math.min(MAX_OPENS, opens + 1);
  startTimer();
}

/** The app left the foreground: remember when, and send what is queued. */
export function noteBackground(): void {
  backgroundAt ??= Date.now();
  void flushViews();
}

/**
 * The app is back. After 30 s away it is a new open, and the screen on top is seen again (a view);
 * a quick trip to copy a code or answer a call is not.
 */
export function noteForeground(screen: string): void {
  const away = backgroundAt === null ? 0 : Date.now() - backgroundAt;
  backgroundAt = null;
  if (disabled || away < RESUME_AFTER_MS) return;
  opens = Math.min(MAX_OPENS, opens + 1);
  lastScreen = '';
  reportScreen(screen);
  startTimer();
}

/** Sends what is queued. Called on the timer, on a full queue, and when the app goes to the background. */
export async function flushViews(): Promise<void> {
  if (sending || disabled) return;
  sending = true;
  try {
    await restore();
    if (queue.length === 0 && opens === 0) return;
    const batch = queue;
    const count = opens;
    queue = [];
    opens = 0;
    // Saved before the request: if the phone suspends the app mid-request, the next launch sends it.
    await persist(batch, count);
    try {
      await apiRequest('POST', '/api/analytics/screens', { body: { device: await device(), screens: batch, opens: count }, timeoutMs: 15_000 });
      await persist([], 0);
    } catch (error) {
      // No server URL means no analytics at all; anything else waits for the next batch.
      if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'no_api_url') {
        disabled = true;
        await persist([], 0);
        return;
      }
      queue = [...batch, ...queue].slice(0, MAX_QUEUE);
      opens = Math.min(MAX_OPENS, opens + count);
    }
  } finally {
    sending = false;
    if (queue.length === 0 && opens === 0) stopTimer();
  }
}

function startTimer(): void {
  if (timer) return;
  timer = setInterval(() => void flushViews(), FLUSH_MS);
}

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
