import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { t } from '@/i18n';

type NotificationsModule = typeof import('expo-notifications');

export type PushDevice = { token: string; platform: 'ios' | 'android' };
export type NotificationTarget = { screen: string; type: string };

// expo-notifications is native. Binaries built before it was added do not contain it: the native
// module registry is checked first, because requiring the package without its modules is reported
// by React Native as a fatal error before any try/catch can run (see auth/storage.ts).
export function loadNotifications(): NotificationsModule | null {
  const tokenManager = requireOptionalNativeModule('ExpoPushTokenManager');
  const emitter = requireOptionalNativeModule('ExpoNotificationsEmitter');
  if (!tokenManager || !emitter) {
    console.warn('push module missing', { tokenManager: Boolean(tokenManager), emitter: Boolean(emitter) });
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch (error) {
    console.warn('push module require failed', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** True when this binary can receive push notifications. */
export function hasPushSupport(): boolean {
  return loadNotifications() !== null;
}

let handlerInstalled = false;

/** Notifications that arrive while the app is open still show as banners (the default hides them). */
export function installNotificationHandler(): void {
  const notifications = loadNotifications();
  if (!notifications || handlerInstalled) return;
  handlerInstalled = true;
  // Runs at module scope of the root layout: a throw here would be a launch crash for every member.
  try {
    notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
  } catch (error) {
    console.warn('notification handler failed', error instanceof Error ? error.message : String(error));
  }
}

/**
 * M242: the number on the app icon = the member's unread management messages. Guarded like everything native
 * in this file: a binary without the badge module (or without the function) does nothing, and no failure ever
 * reaches the member — the icon number is a nicety, never an error.
 */
export function setAppBadge(count: number): void {
  try {
    if (!requireOptionalNativeModule('ExpoBadgeModule')) return;
    const notifications = loadNotifications();
    if (!notifications || typeof notifications.setBadgeCountAsync !== 'function') return;
    const wanted = Math.max(0, Math.round(count));
    const write = () => notifications.setBadgeCountAsync(wanted);
    // Written only when it differs from what the icon shows: on iOS writing 0 also empties the notification
    // centre, which must not happen on every launch of an app whose number is already 0.
    const done =
      typeof notifications.getBadgeCountAsync === 'function'
        ? notifications.getBadgeCountAsync().then((current) => (current === wanted ? false : write()))
        : write();
    void done.catch(() => undefined);
  } catch {
    // Nothing to do: the lights inside the app still tell the member.
  }
}

let currentToken: string | null = null;

/** The token registered during this launch (unregistered on sign-out). */
export function currentPushToken(): string | null {
  return currentToken;
}

/** Asks for permission when needed and returns this device's Expo push token; null when the device or build cannot receive push. */
export async function obtainPushToken(): Promise<PushDevice | null> {
  const notifications = loadNotifications();
  if (!notifications || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return null;
  try {
    if (Platform.OS === 'android') {
      await notifications.setNotificationChannelAsync('default', {
        name: t('notifications.channel'),
        importance: notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    let { status } = await notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await notifications.requestPermissionsAsync());
    if (status !== 'granted') return null;
    const extra = (Constants.expoConfig?.extra ?? {}) as { eas?: { projectId?: string } };
    const projectId = extra.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data } = await notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (__DEV__) console.warn('push token (dev only)', data);
    currentToken = data;
    return { token: data, platform: Platform.OS };
  } catch (error) {
    // Simulator, no FCM credentials in this build, or the user refused: no push for this device.
    // The reason is logged (not shown): push silently missing for everyone is how M134 started.
    console.warn('push token unavailable', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** The screen a server notification points at (`data.screen`, an in-app path). */
export function targetOf(data: unknown): NotificationTarget | null {
  const record = (data ?? {}) as { screen?: unknown; type?: unknown };
  if (typeof record.screen !== 'string' || !record.screen.startsWith('/')) return null;
  return { screen: record.screen, type: typeof record.type === 'string' ? record.type : '' };
}

export function deviceLabel(): string {
  if (Platform.OS === 'android') {
    const constants = Platform.constants as { Brand?: string; Model?: string };
    return `${constants.Brand ?? ''} ${constants.Model ?? ''}`.trim() || 'Android';
  }
  return Platform.OS === 'ios' ? 'iPhone' : Platform.OS;
}
