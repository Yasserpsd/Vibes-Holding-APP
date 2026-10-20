import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import type { KV } from '../store.js';

/**
 * M117 «حذف الحساب على ثلاث خطوات» (owner, 2026-10-21): password → an e-mailed code → a random
 * confirm word the app shows and the member types. A confirmed request never deletes at once: it
 * is SCHEDULED 30 days ahead — the member keeps using the app, sees the countdown, and can cancel
 * any time. When the day comes the sweep mails the management to execute the hub deletion (the
 * hub's delete op needs the member's password, which is never stored — rule 1).
 */
export const DELETION_GRACE_DAYS = 30;
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 4;
const RESEND_GAP_SECONDS = 20;

/** The random confirm words — plain, common club words the member types as the third step. */
const WORDS = ['استثمار', 'شراكة', 'ازدهار', 'انطلاقة', 'ريادة', 'طموح', 'نجاح', 'مستقبل'] as const;

export const SCHEDULED_KEY = 'deletion:scheduled';

type PendingDeletion = {
  codeHash: string;
  word: string;
  reason: string;
  codeExpiresAt: string;
  attempts: number;
  sends: number;
  lastSentAt: string;
};

export type ScheduledDeletion = {
  contactId: number;
  uuid: string;
  email: string;
  name: string;
  phone: string;
  reason: string;
  requestedAt: string;
  dueAt: string;
  /** The due-day mail to the management went out (sent once). */
  remindedAt?: string;
};

export type DeletionRequestResult =
  | { ok: true; seconds: number; word: string }
  | { ok: false; reason: 'too_soon'; waitSeconds: number }
  | { ok: false; reason: 'too_many' };

export type DeletionConfirmResult = { ok: true; reason: string } | { ok: false; reason: 'gone' | 'code_expired' | 'locked' | 'bad_word' } | { ok: false; reason: 'bad_code'; attemptsLeft: number };

export type DeletionDeliver = (code: string) => Promise<void>;

const pendingKey = (contactId: number): string => `delete-code:${contactId}`;

function hashCode(contactId: number, code: string): string {
  return createHash('sha256').update(`delete:${contactId}:${code}`).digest('hex');
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Arabic letters compared bare: harakat, tatweel and spaces dropped so a typo-free word always passes. */
function normalizeWord(value: string): string {
  return value.replace(/[ً-ْـ\s]/gu, '').trim();
}

type Doc = { byContact: Record<string, ScheduledDeletion> };

export class AccountDeletionStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly kv: KV,
    /** Local runs on the mock hub without SMTP: the mock's public test code, since no mail can arrive. */
    private readonly fixedCode: string | null = null,
  ) {}

  private async loadScheduled(): Promise<Doc> {
    return (await this.kv.get<Doc>(SCHEDULED_KEY)) ?? { byContact: {} };
  }

  private mutateScheduled<T>(change: (doc: Doc) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const doc = await this.loadScheduled();
      const result = change(doc);
      await this.kv.set(SCHEDULED_KEY, doc);
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Step 1 passed (password checked by the caller): mail the code and hand the app its confirm word. */
  async request(contactId: number, reason: string, deliver: DeletionDeliver): Promise<DeletionRequestResult> {
    const existing = await this.kv.get<PendingDeletion>(pendingKey(contactId));
    const now = Date.now();
    const alive = existing && Date.parse(existing.codeExpiresAt) > now;
    if (alive) {
      if (existing.sends >= MAX_SENDS) return { ok: false, reason: 'too_many' };
      const waitMs = Date.parse(existing.lastSentAt) + RESEND_GAP_SECONDS * 1000 - now;
      if (waitMs > 0) return { ok: false, reason: 'too_soon', waitSeconds: Math.ceil(waitMs / 1000) };
    }
    const code = this.fixedCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    await deliver(code);
    const word = alive ? existing.word : WORDS[randomInt(0, WORDS.length)] ?? WORDS[0];
    const pending: PendingDeletion = {
      codeHash: hashCode(contactId, code),
      word,
      reason: reason || (alive ? existing.reason : ''),
      codeExpiresAt: new Date(now + CODE_MINUTES * 60_000).toISOString(),
      attempts: alive ? existing.attempts : 0,
      sends: alive ? existing.sends + 1 : 1,
      lastSentAt: new Date(now).toISOString(),
    };
    await this.kv.set(pendingKey(contactId), pending);
    return { ok: true, seconds: CODE_MINUTES * 60, word };
  }

  /** Steps 2 + 3 together: the mailed code AND the typed word; a match ends the pending request. */
  async confirm(contactId: number, code: string, word: string): Promise<DeletionConfirmResult> {
    const pending = await this.kv.get<PendingDeletion>(pendingKey(contactId));
    if (!pending) return { ok: false, reason: 'gone' };
    if (Date.parse(pending.codeExpiresAt) <= Date.now()) {
      await this.kv.delete(pendingKey(contactId));
      return { ok: false, reason: 'code_expired' };
    }
    if (!sameHash(pending.codeHash, hashCode(contactId, code))) {
      const attempts = pending.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await this.kv.delete(pendingKey(contactId));
        return { ok: false, reason: 'locked' };
      }
      await this.kv.set(pendingKey(contactId), { ...pending, attempts });
      return { ok: false, reason: 'bad_code', attemptsLeft: MAX_ATTEMPTS - attempts };
    }
    // The word is the third, deliberate step — checked only once the code is right.
    if (normalizeWord(word) !== normalizeWord(pending.word)) return { ok: false, reason: 'bad_word' };
    await this.kv.delete(pendingKey(contactId));
    return { ok: true, reason: pending.reason };
  }

  /** The confirmed request: deletion lands 30 days ahead; asking again only keeps the earlier date. */
  async schedule(who: { contactId: number; uuid: string; email: string; name: string; phone: string }, reason: string, now = Date.now()): Promise<ScheduledDeletion> {
    return this.mutateScheduled((doc) => {
      const existing = doc.byContact[String(who.contactId)];
      if (existing) return existing;
      const row: ScheduledDeletion = {
        ...who,
        reason,
        requestedAt: new Date(now).toISOString(),
        dueAt: new Date(now + DELETION_GRACE_DAYS * 24 * 60 * 60_000).toISOString(),
      };
      doc.byContact[String(who.contactId)] = row;
      return row;
    });
  }

  /** «تراجع عن الحذف»: the member changed his mind inside the 30 days. */
  async cancel(contactId: number): Promise<boolean> {
    return this.mutateScheduled((doc) => {
      if (!doc.byContact[String(contactId)]) return false;
      delete doc.byContact[String(contactId)];
      return true;
    });
  }

  /** The countdown the app shows; null when no deletion is scheduled. */
  async statusOf(contactId: number, now = Date.now()): Promise<{ dueAt: string; daysLeft: number } | null> {
    const row = (await this.loadScheduled()).byContact[String(contactId)];
    if (!row) return null;
    const daysLeft = Math.max(0, Math.ceil((Date.parse(row.dueAt) - now) / (24 * 60 * 60_000)));
    return { dueAt: row.dueAt, daysLeft };
  }

  /** Requests whose 30 days ended and whose execute-now mail has not gone out yet. */
  async due(now = Date.now()): Promise<ScheduledDeletion[]> {
    const doc = await this.loadScheduled();
    return Object.values(doc.byContact).filter((row) => !row.remindedAt && Date.parse(row.dueAt) <= now);
  }

  async markReminded(contactId: number, now = Date.now()): Promise<void> {
    await this.mutateScheduled((doc) => {
      const row = doc.byContact[String(contactId)];
      if (row) row.remindedAt = new Date(now).toISOString();
    });
  }
}
