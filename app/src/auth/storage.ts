// The legacy entry gates its own native module (M92 pattern): safe on every binary.
import * as FileSystem from 'expo-file-system/legacy';

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

const ACCOUNT_FILE = 'account.v1.json';

function accountUri(): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? `${dir}${ACCOUNT_FILE}` : null;
}

/**
 * M165 (owner, 2026-10-31): the last account the server sent, so the app opens on it at once and
 * asks the server behind the splash instead of making the member wait for the hub. The file is
 * app-private; it goes with the token at sign-out. The value is only ever replaced by a server answer.
 */
export async function loadSavedAccount<T>(): Promise<T | null> {
  const uri = accountUri();
  if (!uri) return null;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as T;
  } catch {
    return null;
  }
}

export async function saveAccount(account: unknown | null): Promise<void> {
  const uri = accountUri();
  if (!uri) return;
  try {
    if (account === null) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } else {
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(account));
    }
  } catch {
    // A full disk or a missing directory: the next server answer tries again.
  }
}
