type SecureStoreModule = typeof import('expo-secure-store');

const TOKEN_KEY = 'investorsclub.session';

// expo-secure-store is native. Binaries built before it was added (the M1 APK) do not contain
// it, so it is loaded lazily; without it the session lives in memory for the current launch only.
function loadSecureStore(): SecureStoreModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('expo-secure-store') as SecureStoreModule;
    return typeof module.getItemAsync === 'function' ? module : null;
  } catch {
    return null;
  }
}

let memoryToken: string | null = null;

export async function loadToken(): Promise<string | null> {
  const store = loadSecureStore();
  if (!store) return memoryToken;
  try {
    return await store.getItemAsync(TOKEN_KEY);
  } catch {
    return memoryToken;
  }
}

export async function saveToken(token: string | null): Promise<void> {
  memoryToken = token;
  const store = loadSecureStore();
  if (!store) return;
  try {
    if (token) await store.setItemAsync(TOKEN_KEY, token);
    else await store.deleteItemAsync(TOKEN_KEY);
  } catch {
    // The in-memory copy keeps the session alive for this launch.
  }
}

/** True when the binary can keep the session across launches. */
export function hasSecureStorage(): boolean {
  return loadSecureStore() !== null;
}
