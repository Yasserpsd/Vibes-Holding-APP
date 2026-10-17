import { useSyncExternalStore } from 'react';

import { loadSetting, saveSetting } from '@/lib/deviceStore';

/**
 * M75 «+N» marks: when did this device last LOOK at each section. The tabs compare what the
 * queries already hold against these marks to draw their badges; opening the section clears it.
 * Device-local on purpose (no server round trip, works for guests too).
 */
export type SeenSection = 'inbox' | 'projects' | 'posts' | 'home' | 'account';

const KEY = 'investorsclub.seen';

type SeenMap = Record<SeenSection, number>;

// Until the stored marks load, everything counts as seen (0 badges beat wrong badges at launch).
let marks: SeenMap = {
  inbox: Number.MAX_SAFE_INTEGER,
  projects: Number.MAX_SAFE_INTEGER,
  posts: Number.MAX_SAFE_INTEGER,
  home: Number.MAX_SAFE_INTEGER,
  account: Number.MAX_SAFE_INTEGER,
};
let loaded = false;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  void loadSetting(KEY).then((raw) => {
    try {
      const stored = raw ? (JSON.parse(raw) as Partial<SeenMap>) : {};
      // A section never opened counts from the FIRST launch, not from 1970: nobody opens the
      // app to 260 «new» projects.
      const now = Date.now();
      marks = { inbox: stored.inbox ?? now, projects: stored.projects ?? now, posts: stored.posts ?? now, home: stored.home ?? now, account: stored.account ?? now };
      if (!raw) void saveSetting(KEY, JSON.stringify(marks));
      notify();
    } catch {
      /* keep the safe defaults */
    }
  });
}

export function markSeen(section: SeenSection): void {
  ensureLoaded();
  marks = { ...marks, [section]: Date.now() };
  notify();
  void saveSetting(KEY, JSON.stringify(marks));
}

export function useSeenMarks(): SeenMap {
  ensureLoaded();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => marks,
  );
}

/** How many of `times` (ISO strings) are newer than the section's mark. */
export function countNew(times: (string | null | undefined)[], mark: number): number {
  return times.filter((time) => time && Date.parse(time) > mark).length;
}
