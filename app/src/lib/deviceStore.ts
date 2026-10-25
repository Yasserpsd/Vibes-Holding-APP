import { requireOptionalNativeModule } from 'expo';
// The legacy entry gates its own native module (M92 pattern inside the package): safe on every binary.
import * as FileSystem from 'expo-file-system/legacy';

type SecureStoreModule = typeof import('expo-secure-store');

// expo-secure-store is native. Binaries built before it was added (the M1 APK) do not contain
// it: the native module registry is checked first, because requiring the package when the
// module is missing is a fatal error before any try/catch can run (see auth/storage.ts).
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

/**
 * M125: iOS 26 loses keychain items across launches on some devices (reads work all session,
 * the item is gone after a relaunch — errSecItemNotFound at the OS level). Every value is
 * therefore mirrored in a JSON file inside the app sandbox, and reads fall back to it, so a
 * signed-in member stays signed in even where the keychain forgets. The sandbox file is
 * app-private and encrypted at rest by both platforms.
 */
const MIRROR_FILE = 'device-store.v1.json';

let mirror: Record<string, string> | null = null;
let mirrorLoad: Promise<Record<string, string>> | null = null;

function mirrorUri(): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? `${dir}${MIRROR_FILE}` : null;
}

function loadMirror(): Promise<Record<string, string>> {
  if (mirror) return Promise.resolve(mirror);
  mirrorLoad ??= (async () => {
    const uri = mirrorUri();
    if (uri) {
      try {
        const parsed = JSON.parse(await FileSystem.readAsStringAsync(uri)) as unknown;
        if (parsed && typeof parsed === 'object') {
          mirror = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === 'string'),
          ) as Record<string, string>;
          return mirror;
        }
      } catch {
        // No file yet, or an unreadable one: start empty.
      }
    }
    mirror = {};
    return mirror;
  })();
  return mirrorLoad;
}

// Writes coalesce (saveLargeSetting saves dozens of parts back to back) and run one at a
// time, so the file never holds half of one snapshot interleaved with another.
let mirrorTimer: ReturnType<typeof setTimeout> | null = null;
let mirrorWaiters: (() => void)[] = [];
let mirrorWrite: Promise<void> = Promise.resolve();

function flushMirror(): void {
  mirrorTimer = null;
  const waiters = mirrorWaiters;
  mirrorWaiters = [];
  const uri = mirrorUri();
  const snapshot = JSON.stringify(mirror ?? {});
  mirrorWrite = mirrorWrite
    .then(async () => {
      if (uri) await FileSystem.writeAsStringAsync(uri, snapshot);
    })
    .catch(() => {
      // The secure store and this launch's memory copy still hold the values.
    })
    .then(() => waiters.forEach((resolve) => resolve()));
}

async function mirrorSet(key: string, value: string | null): Promise<void> {
  const map = await loadMirror();
  if (value === null) delete map[key];
  else map[key] = value;
  return new Promise((resolve) => {
    mirrorWaiters.push(resolve);
    mirrorTimer ??= setTimeout(flushMirror, 50);
  });
}

/** Small settings kept across launches (the app language, the session token). Without any storage they last for this launch only. */
const memory = new Map<string, string>();

export async function loadSetting(key: string): Promise<string | null> {
  const store = loadSecureStore();
  if (store) {
    try {
      const value = await store.getItemAsync(key);
      if (value !== null) return value;
    } catch {
      // Fall through to the mirror.
    }
  }
  const mirrored = (await loadMirror())[key];
  if (mirrored !== undefined) return mirrored;
  return memory.get(key) ?? null;
}

export async function saveSetting(key: string, value: string | null): Promise<void> {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  const store = loadSecureStore();
  if (store) {
    try {
      if (value === null) await store.deleteItemAsync(key);
      else await store.setItemAsync(key, value);
    } catch {
      // The mirror and the in-memory copy still serve.
    }
  }
  await mirrorSet(key, value);
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

/** True when the binary can keep values across launches in the OS secure store (read by auth/storage.ts). */
export function hasSecureStoreModule(): boolean {
  return loadSecureStore() !== null;
}
