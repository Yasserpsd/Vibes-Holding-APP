import { usePathname, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { flushViews, reportScreen } from '@/lib/analytics';
import { noteCurrentPath } from '@/lib/reloadApp';

/**
 * M33 (M22): reports which screen is open, by its route name alone (`(tabs)/news`, `project/[id]`…) —
 * never an id, a parameter or anything typed. Batched in lib/analytics; the queue is flushed when the
 * app leaves the foreground. Renders nothing.
 */
export function ScreenTracker() {
  const segments = useSegments();
  const pathname = usePathname();
  const screen = segments.length ? segments.join('/') : '(tabs)';

  useEffect(() => {
    reportScreen(screen);
  }, [screen]);

  // The open path stays on the device: lib/reloadApp.ts reads it so an update is never applied over a form.
  useEffect(() => {
    noteCurrentPath(pathname);
  }, [pathname]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flushViews();
    });
    return () => subscription.remove();
  }, []);

  return null;
}
