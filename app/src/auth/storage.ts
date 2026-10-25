import { hasSecureStoreModule, loadSetting, saveSetting } from '@/lib/deviceStore';

const TOKEN_KEY = 'investorsclub.session';

/**
 * The session token rides the shared device store: the OS secure store first, with the M125
 * sandbox-file mirror behind it — iOS 26 loses keychain items across launches on some devices,
 * and a signed-in member must stay signed in until an explicit logout.
 */
export async function loadToken(): Promise<string | null> {
  return loadSetting(TOKEN_KEY);
}

export async function saveToken(token: string | null): Promise<void> {
  await saveSetting(TOKEN_KEY, token);
}

/** True when the binary can keep the session across launches. */
export function hasSecureStorage(): boolean {
  return hasSecureStoreModule();
}
