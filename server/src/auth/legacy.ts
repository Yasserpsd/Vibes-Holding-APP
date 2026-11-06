import type { KV } from '../store.js';

export const LEGACY_KEY = 'legacy-accounts';

/** `before` = the hub's own `created_at` limit (UTC `Y-m-d H:i:s`) the ids were picked with. */
export type LegacySnapshot = { before: string; ids: number[]; takenAt: string; by: string };

/** 2026-11-06 00:00 in Riyadh: the day the short sign-up with the WhatsApp code went live (M203). */
export const LEGACY_BEFORE_UTC = '2026-11-05 21:00:00';

/**
 * M204 (owner, 2026-11-06: «سيب الناس القديمة زي ما هي شغاله بإيميل عادي بحيث محدش يحصل عنده لخبطة، اهم حاجه عندي اللي
 * بيسجل جديد»; then «اللي تعامل جديد اجباري ياكد رقم واتس اب… واحدة واحدة كله يتحول واتس اب»): the accounts that existed
 * before the WhatsApp sign-up. While such an account's number is unproven it signs in as it always did and sees no
 * reminder; its first new dealing asks for the number (the app's gate), and from then on it is an ordinary account.
 *
 * The hub's public contact carries no registration date, so the list is a snapshot of ids taken once from the hub's own
 * registry (`admin_accounts.created_at`, rule 2: nothing is decided from a registry of ours). No snapshot = nobody is old.
 */
export class LegacyAccounts {
  private ids = new Set<number>();
  private snapshot: LegacySnapshot | null = null;
  private loadedAt = 0;

  constructor(
    private readonly kv: KV,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    this.snapshot = (await this.kv.get<LegacySnapshot>(LEGACY_KEY)) ?? null;
    this.ids = new Set(this.snapshot?.ids ?? []);
    this.loadedAt = this.now();
  }

  /** Answers from memory; another instance's snapshot is picked up within five minutes. */
  has(contactId: number): boolean {
    if (this.now() - this.loadedAt > 5 * 60_000) {
      this.loadedAt = this.now();
      void this.load().catch(() => undefined);
    }
    return this.ids.has(contactId);
  }

  async save(ids: number[], before: string, by: string): Promise<LegacySnapshot> {
    const snapshot: LegacySnapshot = { before, ids: [...new Set(ids)].sort((a, b) => a - b), takenAt: new Date(this.now()).toISOString(), by };
    await this.kv.set(LEGACY_KEY, snapshot);
    await this.load();
    return snapshot;
  }

  get info(): { before: string; count: number; takenAt: string; by: string } | null {
    return this.snapshot ? { before: this.snapshot.before, count: this.snapshot.ids.length, takenAt: this.snapshot.takenAt, by: this.snapshot.by } : null;
  }
}
