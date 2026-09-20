import type { KV } from '../store.js';

/**
 * `GET /api/sync` (docs/BRIDGE_V2.md 4): one small answer the app polls to learn that something changed, so a post, an
 * event or a project published anywhere shows up at once instead of at the next long refresh. A version is the time of
 * the last change in ms (0 = never); the app compares for inequality, so a storage reset also counts as a change.
 */
export const SYNC_KEY = 'sync:versions';
export const SYNC_KEYS = ['posts', 'projects', 'news', 'content', 'feed'] as const;
export type SyncKey = (typeof SYNC_KEYS)[number];
export type SyncVersions = Record<SyncKey, number>;

export class SyncService {
  private chain: Promise<unknown> = Promise.resolve();
  /** Every open app asks every few seconds: the versions are read from kv once and served from memory (single-instance server). */
  private known: Promise<SyncVersions> | null = null;

  constructor(private readonly kv: KV) {}

  private load(): Promise<SyncVersions> {
    if (this.known) return this.known;
    const loading = this.kv.get<Partial<SyncVersions>>(SYNC_KEY).then((stored) => Object.fromEntries(SYNC_KEYS.map((key) => [key, typeof stored?.[key] === 'number' ? stored[key] : 0])) as SyncVersions);
    this.known = loading;
    // A failed read is not kept: the next caller asks kv again.
    loading.catch(() => {
      if (this.known === loading) this.known = null;
    });
    return loading;
  }

  async versions(): Promise<SyncVersions> {
    return { ...(await this.load()) };
  }

  /**
   * Serialized; a version only ever grows. The copy in memory moves first, so the apps learn of the change even when
   * the write to kv fails (the caller still gets the failure).
   */
  bump(...keys: SyncKey[]): Promise<void> {
    const run = this.chain.then(async () => {
      const versions = await this.load();
      for (const key of keys) versions[key] = Math.max(versions[key] + 1, Date.now());
      await this.kv.set(SYNC_KEY, versions);
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}
