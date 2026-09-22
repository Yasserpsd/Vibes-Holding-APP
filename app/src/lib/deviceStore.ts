import { requireOptionalNativeModule } from 'expo';

type SecureStoreModule = typeof import('expo-secure-store');

// expo-secure-store is the only on-device storage in the binary. Binaries built before it was added
// (the M1 APK) do not contain it: the native module registry is checked first, because requiring the
// package when the module is missing is a fatal error before any try/catch can run (see auth/storage.ts).
function loadSecureStore(): SecureStoreModule | null {
  if (!requireOptionalNativeModule('ExpoSecureStore')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('expo-secure-store') as SecureStoreModule;
    return typeof module.getItemAsync === 'function' ? module : null;
  } catch {
    return null;
  }
}

/** Small settings kept across launches (the app language). Without storage they last for this launch only. */
const memory = new Map<string, string>();

export async function loadSetting(key: string): Promise<string | null> {
  const store = loadSecureStore();
  if (!store) return memory.get(key) ?? null;
  try {
    return await store.getItemAsync(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export async function saveSetting(key: string, value: string | null): Promise<void> {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  const store = loadSecureStore();
  if (!store) return;
  try {
    if (value === null) await store.deleteItemAsync(key);
    else await store.setItemAsync(key, value);
  } catch {
    // The in-memory copy serves this launch.
  }
}

// The iOS keychain is meant for values up to about 2 KB, and Arabic takes up to 3 bytes a character:
// a longer text is split into parts of 600 characters, with the number of parts under the key itself.
const PART_CHARS = 600;
const MAX_PARTS = 80;

function splitText(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + PART_CHARS, value.length);
    // Never cut a surrogate pair (an emoji) in two: a lone half does not survive UTF-8 storage.
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(value.slice(start, end));
    start = end;
  }
  return parts;
}

export async function saveLargeSetting(key: string, value: string | null): Promise<void> {
  const before = Number(await loadSetting(key)) || 0;
  const parts = value === null ? [] : splitText(value);
  if (parts.length > MAX_PARTS) return;
  // The count goes last: a write cut half-way leaves the previous count pointing at mixed parts, which fail to parse and are ignored.
  for (let index = 0; index < parts.length; index += 1) await saveSetting(`${key}.${index}`, parts[index] ?? '');
  for (let index = parts.length; index < before; index += 1) await saveSetting(`${key}.${index}`, null);
  await saveSetting(key, value === null ? null : String(parts.length));
}

export async function loadLargeSetting(key: string): Promise<string | null> {
  const count = Number(await loadSetting(key)) || 0;
  if (count <= 0 || count > MAX_PARTS) return null;
  const parts = await Promise.all(Array.from({ length: count }, (_, index) => loadSetting(`${key}.${index}`)));
  return parts.some((part) => part === null) ? null : parts.join('');
}
