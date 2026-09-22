import { apiRequest } from '@/api/client';
import { loadSetting, saveSetting } from '@/lib/deviceStore';

/**
 * M33 (M22): batched screen-view reporting to our own server — aggregates only, no third-party
 * service. A batch carries screen names alone (`(tabs)/news`, `project/[id]`…), never ids or
 * parameters; the server counts views per screen and unique visitors per day and keeps nothing
 * per member. Failures are dropped quietly: analytics must never cost the member anything.
 */
const DEVICE_KEY = 'analytics.device';
const FLUSH_MS = 30_000;
const FLUSH_AT = 20;
const MAX_QUEUE = 60;
const SCREEN_NAME = /^[a-z0-9/\[\]()._-]{1,64}$/i;

let queue: string[] = [];
let lastScreen = '';
let deviceId: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let sending = false;
let disabled = false;

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

/** One opened screen. Repeats of the screen already on top are not views. */
export function reportScreen(screen: string): void {
  if (disabled || !SCREEN_NAME.test(screen) || screen === lastScreen) return;
  lastScreen = screen;
  if (queue.length >= MAX_QUEUE) return;
  queue.push(screen);
  if (queue.length >= FLUSH_AT) void flushViews();
  else startTimer();
}

/** Sends what is queued. Called on the timer, on a full queue, and when the app goes to the background. */
export async function flushViews(): Promise<void> {
  if (sending || disabled || queue.length === 0) return;
  sending = true;
  const batch = queue;
  queue = [];
  try {
    await apiRequest('POST', '/api/analytics/screens', { body: { device: await device(), screens: batch }, timeoutMs: 15_000 });
  } catch (error) {
    // No server URL means no analytics at all; anything else just loses this batch.
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'no_api_url') disabled = true;
  } finally {
    sending = false;
    if (queue.length === 0) stopTimer();
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
