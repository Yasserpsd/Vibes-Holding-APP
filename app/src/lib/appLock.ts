import { requireOptionalNativeModule } from 'expo';

import { loadSetting, saveSetting } from '@/lib/deviceStore';

/**
 * M118d (owner: «تفعيل بصمة الوجه بحيث الابلكيشن ميفتحش غير لما يفتح بوشه»): the biometric app
 * lock. expo-local-authentication is a NATIVE module, so binaries built before it (build 9 and
 * older) do not contain it — the registry is checked before any require (M92 pattern) and the
 * security screen then says the lock arrives with the next app update.
 */
type LocalAuthModule = typeof import('expo-local-authentication');

const ENABLED_KEY = 'appLock.enabled';

export function loadLocalAuth(): LocalAuthModule | null {
  if (!requireOptionalNativeModule('ExpoLocalAuthentication')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-local-authentication') as LocalAuthModule;
  } catch {
    return null;
  }
}

/** True when this binary has the module AND the device enrolled a biometric (face or fingerprint). */
export async function lockAvailable(): Promise<boolean> {
  const auth = loadLocalAuth();
  if (!auth) return false;
  try {
    return (await auth.hasHardwareAsync()) && (await auth.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function lockEnabled(): Promise<boolean> {
  return (await loadSetting(ENABLED_KEY)) === '1';
}

export async function setLockEnabled(enabled: boolean): Promise<void> {
  await saveSetting(ENABLED_KEY, enabled ? '1' : '0');
}

/** One biometric prompt; true opens the app. */
export async function authenticate(promptMessage: string): Promise<boolean> {
  const auth = loadLocalAuth();
  if (!auth) return true;
  try {
    const result = await auth.authenticateAsync({ promptMessage, cancelLabel: '', disableDeviceFallback: false });
    return result.success;
  } catch {
    return false;
  }
}
