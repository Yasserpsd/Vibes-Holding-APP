import { useQueryClient } from '@tanstack/react-query';
import { useRootNavigationState, useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';

import { pushApi } from '@/api/push';
import { useAuth } from '@/auth/AuthProvider';
import { env } from '@/config/env';
import { deviceLabel, loadNotifications, obtainPushToken, targetOf } from '@/lib/notifications';

/**
 * Registers this device for push after login and routes notification taps to the screen the
 * server named in `data.screen`. Renders nothing; lives under the providers in the root layout.
 */
export function PushRegistrar() {
  const { status, me, refresh } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const navigationState = useRootNavigationState();
  const ready = Boolean(navigationState?.key);
  const contactId = me?.id ?? null;
  const handled = useRef<Set<string>>(new Set());

  // Token → server once per signed-in account per launch (the server keeps one entry per device).
  useEffect(() => {
    if (status !== 'signedIn' || contactId === null) return;
    let cancelled = false;
    (async () => {
      const device = await obtainPushToken();
      if (!device || cancelled) return;
      try {
        await pushApi.register({ ...device, deviceName: deviceLabel(), appVersion: env.appVersion });
      } catch {
        // Offline or an older server: the next launch registers again.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, contactId]);

  useEffect(() => {
    const notifications = loadNotifications();
    if (!notifications || !ready) return;
    const open = (identifier: string, data: unknown) => {
      if (handled.current.has(identifier)) return;
      handled.current.add(identifier);
      const target = targetOf(data);
      if (target) router.push(target.screen as Href);
    };
    // A tap that launched the app: the response waits until the navigator is ready.
    notifications
      .getLastNotificationResponseAsync()
      .then((response) => {
        if (response) open(response.notification.request.identifier, response.notification.request.content.data);
      })
      .catch(() => undefined);
    const tapped = notifications.addNotificationResponseReceivedListener((response) =>
      open(response.notification.request.identifier, response.notification.request.content.data),
    );
    // Arrivals while the app is open refresh the data behind them.
    const received = notifications.addNotificationReceivedListener((notification) => {
      const target = targetOf(notification.request.content.data);
      if (!target) return;
      if (target.type === 'membership') void refresh();
      if (target.type === 'payment') void queryClient.invalidateQueries({ queryKey: ['payments'] });
      if (target.type === 'hq_visit') void queryClient.invalidateQueries({ queryKey: ['hq'] });
    });
    return () => {
      tapped.remove();
      received.remove();
    };
  }, [ready, router, refresh, queryClient]);

  return null;
}
