import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { ApiError, apiRequest } from '@/api/client';

const POLL_MS = 10_000;
/** Shorter than the interval: a stalled request is given up before the next tick, so `busy` never blocks the poller. */
const REQUEST_TIMEOUT_MS = 8_000;

/** `GET /api/sync`: the time of the last change of each part (ms, 0 = never). */
type SyncPart = 'posts' | 'projects' | 'news' | 'content';
type SyncAnswer = { v?: Partial<Record<SyncPart | 'feed', number>> };

// What to refetch when a part changes. Account data (prefs, payments, visits, project access) is not here.
// `feed` (the websites' changes) has no screen in the app, so it is not watched.
const QUERY_KEYS: Record<SyncPart, QueryKey[]> = {
  posts: [['posts'], ['post']],
  projects: [['projects'], ['project'], ['project-brief']],
  news: [['news', 'feed'], ['news', 'decisions']],
  content: [['content'], ['services'], ['service'], ['membership', 'content'], ['golden'], ['hq', 'overview'], ['videos']],
};
const PARTS = Object.keys(QUERY_KEYS) as SyncPart[];

/**
 * Instant sync: one poller for the whole app. While the app is in the foreground it asks the server every
 * 10 seconds what changed and invalidates the matching queries, so something published from the dashboard or
 * the websites shows up without a pull-to-refresh. Paused in the background. Renders nothing.
 */
export function SyncPoller() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let busy = false;
    let unsupported = false;
    // The first answer only sets the baseline: what is on screen was just loaded.
    let seen: Partial<Record<SyncPart, number>> | null = null;

    const tick = async () => {
      if (busy || unsupported) return;
      busy = true;
      try {
        // Public route: no session token, so a failure here can never sign the member out.
        const answer = await apiRequest<SyncAnswer>('GET', '/api/sync', { token: null, timeoutMs: REQUEST_TIMEOUT_MS });
        const versions = answer.v ?? {};
        const previous = seen;
        const next: Partial<Record<SyncPart, number>> = {};
        for (const part of PARTS) {
          const version = versions[part];
          if (typeof version !== 'number') continue;
          next[part] = version;
          if (previous && previous[part] !== undefined && previous[part] !== version) {
            for (const queryKey of QUERY_KEYS[part]) void queryClient.invalidateQueries({ queryKey });
          }
        }
        seen = { ...previous, ...next };
      } catch (error) {
        // A server without the route (older deploy): stop asking until the app comes back to the foreground.
        if (error instanceof ApiError && error.status === 404) unsupported = true;
      } finally {
        busy = false;
      }
    };

    const start = () => {
      if (timer) return;
      unsupported = false;
      void tick();
      timer = setInterval(() => void tick(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    // At launch the state can still be unknown: only a known background state keeps the poller off.
    if (AppState.currentState !== 'background') start();
    const subscription = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()));
    return () => {
      stop();
      subscription.remove();
    };
  }, [queryClient]);

  return null;
}
