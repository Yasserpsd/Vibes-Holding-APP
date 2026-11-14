import type { KV } from './store.js';
import { compareVersions, type StorePlatform } from './storeVersions.js';

/**
 * M239: launches per day — platform, what the phone proved about its installed binary, and the verdict. Two
 * uses: the owner sees who is still on what (and that nobody current is ever stopped), and a new store
 * version only becomes the forced-update floor once phones of that platform are really running it.
 * Counted in memory and written to one kv row every few minutes; the names come from the client, so only a
 * version of a real shape is counted by name and the number of lines is capped.
 */
const KEY = 'app:versionStats';
const FLUSH_MS = 5 * 60_000;
const KEEP_DAYS = 14;
const MAX_KEYS = 300;
const COUNTED = /^\d{1,3}(\.\d{1,3}){1,3}$/;
/**
 * A new version has «reached» a platform when, over the last days, this many phones proved they run exactly it
 * and they are a clear majority of the phones that named their binary. The share is a BRAKE, not proof of a full
 * rollout: a Play rollout staged at half the phones or less can never pass it, one staged above that can.
 * OPERATING RULE: a production release goes out at 100% (eas.json sets no rollout fraction); when one must be
 * staged or halted, set APP_VERSION_GATE=0 until it is at 100%.
 */
export const REACH_DAYS = 3;
export const REACH_MIN_LAUNCHES = 30;
export const REACH_MIN_SHARE = 0.6;
/** One phone is counted once a day per line (by address): the most addresses remembered for the day. */
const MAX_SEEN = 100_000;

export type Proof = { source: 'binary' | 'ios-build' | 'bundle'; version: string } | null;
export type Verdict = 'ok' | 'old' | 'blocked';
type Days = Record<string, Record<string, number>>;

const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

export class VersionStats {
  private pending = new Map<string, number>();
  private flushedAt = Date.now();
  private flushing: Promise<Days> | null = null;
  private seen = new Set<string>();
  private seenDay = '';

  constructor(private readonly kv: KV) {}

  /**
   * Never throws and never waits: it sits on the request path. `who` (the caller's address) makes it one count a
   * day per phone and line — the app asks at every launch and every return to the foreground, and a loop of
   * requests from one place must not look like a fleet.
   */
  count(platform: StorePlatform | null, proof: Proof, verdict: Verdict, at: { who?: string; now?: number } = {}): void {
    const now = at.now ?? Date.now();
    const day = dayOf(now);
    const named = proof && COUNTED.test(proof.version) ? `${proof.source}:${proof.version}` : proof ? 'other' : 'no-proof';
    if (at.who) {
      if (day !== this.seenDay) {
        this.seen.clear();
        this.seenDay = day;
      }
      const mark = `${platform ?? 'unknown'} ${named} ${verdict} ${at.who}`;
      if (this.seen.has(mark)) return;
      if (this.seen.size < MAX_SEEN) this.seen.add(mark);
    }
    let key = `${day} ${platform ?? 'unknown'} ${named} ${verdict}`;
    if (!this.pending.has(key) && this.pending.size >= MAX_KEYS) key = `${day} ${platform ?? 'unknown'} other ${verdict}`;
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    if (now - this.flushedAt > FLUSH_MS) void this.flush().catch(() => undefined);
  }

  /** Writes what was counted and returns every kept day. One flush at a time; a failed write keeps its counts. */
  flush(): Promise<Days> {
    this.flushing ??= this.write().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async write(): Promise<Days> {
    this.flushedAt = Date.now();
    const batch = this.pending;
    this.pending = new Map();
    try {
      const all = (await this.kv.get<Days>(KEY)) ?? {};
      if (!batch.size) return all;
      for (const [key, count] of batch) {
        const [day = '', ...rest] = key.split(' ');
        const bucket = (all[day] ??= {});
        const line = rest.join(' ');
        const name = line in bucket || Object.keys(bucket).length < MAX_KEYS ? line : `${rest[0]} other ${rest[2]}`;
        bucket[name] = (bucket[name] ?? 0) + count;
      }
      for (const day of Object.keys(all).sort().slice(0, -KEEP_DAYS)) delete all[day];
      await this.kv.set(KEY, all);
      return all;
    } catch (error) {
      for (const [key, count] of batch) this.pending.set(key, (this.pending.get(key) ?? 0) + count);
      throw error;
    }
  }

  /**
   * Are phones of this platform really running `version`? Only launches that named their installed binary count
   * (`binary:`), over the last days: enough on exactly that version, and a clear majority. A higher number is a
   * tester build or a made-up header: it stays in the total only.
   */
  async reached(platform: StorePlatform, version: string, now = Date.now()): Promise<{ reached: boolean; launches: number; onIt: number }> {
    const all = await this.flush();
    const from = dayOf(now - (REACH_DAYS - 1) * 86_400_000);
    let launches = 0;
    let onIt = 0;
    for (const [day, bucket] of Object.entries(all)) {
      if (day < from) continue;
      for (const [line, count] of Object.entries(bucket)) {
        const [where, proof = '', verdict] = line.split(' ');
        if (where !== platform || verdict === 'blocked' || !proof.startsWith('binary:')) continue;
        launches += count;
        if (compareVersions(proof.slice('binary:'.length), version) === 0) onIt += count;
      }
    }
    return { reached: onIt >= REACH_MIN_LAUNCHES && onIt / Math.max(1, launches) >= REACH_MIN_SHARE, launches, onIt };
  }
}
