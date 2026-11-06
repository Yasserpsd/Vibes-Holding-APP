import { useCallback, useEffect, useState } from 'react';

import { loadSetting, saveSetting } from '@/lib/deviceStore';

const WEEK_MS = 7 * 24 * 60 * 60_000;

/**
 * M204 (owner, 2026-11-06: «خليها مرة في الاسبوع مش في اليوم»): a reminder is due when its «لاحقًا» is older than
 * seven days on this device. `key` null = nothing to remind about; `due` null = the saved date is still being read.
 */
export function useWeeklyNudge(key: string | null): { due: boolean | null; snooze: () => void } {
  const [state, setState] = useState<{ key: string; due: boolean } | null>(null);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    void loadSetting(key).then((savedAt) => {
      const last = savedAt ? Date.parse(savedAt) : 0;
      if (alive) setState({ key, due: !last || Date.now() - last > WEEK_MS });
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const snooze = useCallback(() => {
    if (!key) return;
    setState({ key, due: false });
    void saveSetting(key, new Date().toISOString());
  }, [key]);

  return { due: key ? (state?.key === key ? state.due : null) : false, snooze };
}
