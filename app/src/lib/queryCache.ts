import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';
// The legacy entry gates its own native module (M92 pattern): safe on every binary.
import * as FileSystem from 'expo-file-system/legacy';

import { getLang, type Lang } from '@/i18n';

/**
 * M152 (owner: «التطبيق بطيء شوية عايزه أسرع»): the public content queries survive a relaunch.
 * The home paints at once from the last visit and TanStack refreshes whatever is stale behind it,
 * instead of a skeleton that waits for the network on every cold start. One JSON file in the app
 * sandbox (expo-file-system, already inside the 1.1.0 binary), written at most once a second.
 *
 * Only shared content is kept — never the account, the card, the wallet or anything the server sends
 * with `no-store` FOR THIS MEMBER (CLAUDE.md rule 8 stays on the wire; the keys cleared at sign-out
 * are rewritten the moment they are removed, so nothing of a signed-out member stays on disk).
 */
const FILE = 'query-cache.v1.json';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const WRITE_DELAY_MS = 1000;
// M165: 'auth' holds only the public registration config (countries, personas): the completion gate and
// the register screen draw their fields from the file at once and refresh behind.
const KEEP_ROOTS = new Set(['content', 'services', 'videos', 'partners', 'posts', 'people', 'agenda', 'projects', 'golden', 'meetups', 'auth']);

// The server answers in the app's language (x-app-lang), so a snapshot belongs to the language it was
// saved in: after a language switch the other language's copy is dropped, never painted (owner, 2026-11-01).
type Snapshot = { savedAt: number; lang: Lang; state: ReturnType<typeof dehydrate> };

function fileUri(): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? `${dir}${FILE}` : null;
}

function keepQuery(queryKey: readonly unknown[]): boolean {
  if (typeof queryKey[0] !== 'string' || !KEEP_ROOTS.has(queryKey[0])) return false;
  // The member's ticket (name and QR) and the signed recording links never go to disk (keys in api/agenda.ts:
  // ['agenda', 'ticket', …] and ['agenda', 'recordings', …]). The same test drops them from an older file on restore.
  if (queryKey[0] === 'agenda' && (queryKey[1] === 'ticket' || queryKey[1] === 'recordings')) return false;
  return true;
}

/** Fills the cache from the last launch's file (call after initI18n). Never throws: a missing or bad file is an empty cache. */
export async function restoreQueryCache(client: QueryClient): Promise<boolean> {
  const uri = fileUri();
  if (!uri) return false;
  try {
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(uri)) as Partial<Snapshot> | null;
    if (!parsed || typeof parsed.savedAt !== 'number' || !parsed.state || !Array.isArray(parsed.state.queries)) return false;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return false;
    if (parsed.lang !== getLang()) return false;
    const fresh = parsed.state.queries.filter((query) => keepQuery(query.queryKey) && Date.now() - query.state.dataUpdatedAt <= MAX_AGE_MS);
    hydrate(client, { mutations: [], queries: fresh });
    return fresh.length > 0;
  } catch {
    return false;
  }
}

/** Mirrors the kept queries to the file after every change (coalesced). Returns the unsubscribe. */
export function persistQueryCache(client: QueryClient): () => void {
  const uri = fileUri();
  if (!uri) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();
  const flush = () => {
    timer = null;
    // Runs from a timer: a throw (an odd value that JSON cannot hold) would be an uncaught error, a crash in a release build.
    try {
      const snapshot: Snapshot = {
        savedAt: Date.now(),
        lang: getLang(),
        state: dehydrate(client, { shouldDehydrateQuery: (query) => query.state.status === 'success' && keepQuery(query.queryKey), shouldDehydrateMutation: () => false }),
      };
      const text = JSON.stringify(snapshot);
      writing = writing.then(() => FileSystem.writeAsStringAsync(uri, text)).catch(() => undefined);
    } catch {
      // This snapshot is skipped; the next change writes a new one.
    }
  };
  // A removal is written at once: sign-out clears the whole cache, and an app killed inside the usual one-second
  // delay would keep the signed-out member's content in the file until the next launch. The cache reports each
  // removed query synchronously, one by one, while `clear()` is still emptying it, so the write waits for the end
  // of that synchronous run (a microtask): one write, taken when every removal of the run is done.
  let removalQueued = false;
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === 'removed') {
      if (removalQueued) return;
      removalQueued = true;
      void Promise.resolve().then(() => {
        removalQueued = false;
        if (timer) clearTimeout(timer);
        flush();
      });
      return;
    }
    timer ??= setTimeout(flush, WRITE_DELAY_MS);
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
