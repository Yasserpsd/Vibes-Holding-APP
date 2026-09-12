import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

export type PushDevice = { token: string; platform: 'ios' | 'android' };
export type NotificationTarget = { screen: string; type: string };

// expo-notifications is native. Binaries built before it was added do not contain it: the native
// module registry is checked first, because requiring the package without its modules is reported
// by React Native as a fatal error before any try/catch can run (see auth/storage.ts).
export function loadNotifications(): NotificationsModule | null {
  if (!requireOptionalNativeModule('ExpoPushTokenManager') || !requireOptionalNativeModule('ExpoNotificationsEmitter')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
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
  notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
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
        name: 'إشعارات النادي',
        importance: notifications.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    let { status } = await notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await notifications.requestPermissionsAsync());
    if (status !== 'granted') return null;
    const extra = (Constants.expoConfig?.extra ?? {}) as { eas?: { projectId?: string } };
    const projectId = extra.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data } = await notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    currentToken = data;
    return { token: data, platform: Platform.OS };
  } catch {
    // Simulator, no FCM credentials in this build, or the user refused: no push for this device.
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
