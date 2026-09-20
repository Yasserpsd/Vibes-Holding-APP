import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import type { KV } from '../store.js';
import { newToken } from './sessions.js';

/** A dashboard sign-in whose hub password was accepted and that waits for the e-mailed code (M18). */
export type OtpChallenge = {
  uuid: string;
  contactId: number;
  email: string;
  /** sha256 of the challenge token and the code: the stored row alone cannot be searched for the code. */
  codeHash: string;
  codeExpiresAt: string;
  attempts: number;
  sends: number;
  lastSentAt: string;
  expiresAt: string;
};

/** What one hub account spent in the running hour: a right password must not buy endless codes, guesses or mails. */
type OtpAccount = { windowStart: string; challenges: number; wrong: number; liveKey: string | null };

export type OtpCreate = { ok: true; token: string } | { ok: false; reason: 'cooldown'; waitSeconds: number };

export type OtpCheck =
  | { ok: true; challenge: OtpChallenge }
  | { ok: false; reason: 'gone' | 'locked' | 'code_expired' }
  | { ok: false; reason: 'bad_code'; attemptsLeft: number };

export type OtpReissue = { ok: true } | { ok: false; reason: 'gone' | 'too_many' } | { ok: false; reason: 'too_soon'; waitSeconds: number };

/** Mails the code; a throw means no mail left and nothing about the challenge changes. */
export type OtpDeliver = (email: string, code: string) => Promise<void>;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const CHALLENGE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** The first mail and three «إعادة الإرسال». */
const MAX_SENDS = 4;
export const OTP_RESEND_GAP_SECONDS = 20;
const ACCOUNT_WINDOW_MS = 60 * 60_000;
const MAX_CHALLENGES_PER_WINDOW = 6;
const MAX_WRONG_PER_WINDOW = 10;

function keyFor(token: string): string {
  return `admin-otp:${createHash('sha256').update(token).digest('hex')}`;
}

function accountKey(contactId: number): string {
  return `admin-otp-account:${contactId}`;
}

function hashCode(token: string, code: string): string {
  return createHash('sha256').update(`${token}:${code}`).digest('hex');
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Codes are kept hashed, live `seconds` counted from the moment the mail left, work once, and a challenge dies after
 * five wrong codes. An account has one live challenge and an hourly budget of challenges and wrong codes, whatever
 * address the requests come from. The code itself is never logged.
 */
export class AdminOtpStore {
  /** One step at a time per challenge and per account: the KV has no atomic counter, parallel guesses must not share one attempt. */
  private readonly busy = new Map<string, Promise<unknown>>();

  constructor(
    private readonly kv: KV,
    readonly seconds: number,
    /** Local runs on the mock hub without SMTP: the mock's public test code, since no mail can arrive. */
    private readonly fixedCode: string | null = null,
  ) {}

  async create(uuid: string, contactId: number, email: string, deliver: OtpDeliver): Promise<OtpCreate> {
    return this.exclusive(accountKey(contactId), async () => {
      const account = await this.loadAccount(contactId);
      if (account.challenges >= MAX_CHALLENGES_PER_WINDOW || account.wrong >= MAX_WRONG_PER_WINDOW) {
        return { ok: false, reason: 'cooldown', waitSeconds: Math.max(1, Math.ceil((Date.parse(account.windowStart) + ACCOUNT_WINDOW_MS - Date.now()) / 1000)) };
      }
      // A new sign-in ends the account's earlier challenge; the try is counted before the mail, sent or not.
      if (account.liveKey) await this.kv.delete(account.liveKey);
      const spent: OtpAccount = { ...account, challenges: account.challenges + 1, liveKey: null };
      await this.kv.set(accountKey(contactId), spent);
      const token = newToken();
      const code = this.newCode();
      await deliver(email, code);
      const now = Date.now();
      const challenge: OtpChallenge = {
        uuid,
        contactId,
        email,
        codeHash: hashCode(token, code),
        codeExpiresAt: new Date(now + this.seconds * 1000).toISOString(),
        attempts: 0,
        sends: 1,
        lastSentAt: new Date(now).toISOString(),
        expiresAt: new Date(now + CHALLENGE_MINUTES * 60_000).toISOString(),
      };
      await this.kv.set(keyFor(token), challenge);
      await this.kv.set(accountKey(contactId), { ...spent, liveKey: keyFor(token) });
      return { ok: true, token };
    });
  }

  /** «إعادة الإرسال»: a new code replaces the old one once its mail left; wrong attempts are not forgiven. */
  async reissue(token: string, deliver: OtpDeliver): Promise<OtpReissue> {
    return this.exclusive(keyFor(token), async () => {
      const challenge = await this.load(token);
      if (!challenge) return { ok: false, reason: 'gone' };
      if (challenge.sends >= MAX_SENDS) return { ok: false, reason: 'too_many' };
      const waitMs = Date.parse(challenge.lastSentAt) + OTP_RESEND_GAP_SECONDS * 1000 - Date.now();
      if (waitMs > 0) return { ok: false, reason: 'too_soon', waitSeconds: Math.ceil(waitMs / 1000) };
      const code = this.newCode();
      await deliver(challenge.email, code);
      const now = Date.now();
      await this.kv.set(keyFor(token), {
        ...challenge,
        codeHash: hashCode(token, code),
        codeExpiresAt: new Date(now + this.seconds * 1000).toISOString(),
        sends: challenge.sends + 1,
        lastSentAt: new Date(now).toISOString(),
      });
      return { ok: true };
    });
  }

  /** A right code ends the challenge (single use); so do five wrong ones, or the account's hourly budget of wrong codes. */
  async check(token: string, code: string): Promise<OtpCheck> {
    return this.exclusive(keyFor(token), async () => {
      const challenge = await this.load(token);
      if (!challenge) return { ok: false, reason: 'gone' };
      if (Date.parse(challenge.codeExpiresAt) <= Date.now()) return { ok: false, reason: 'code_expired' };
      if (sameHash(challenge.codeHash, hashCode(token, code))) {
        await this.kv.delete(keyFor(token));
        await this.updateAccount(challenge.contactId, (account) => ({ ...account, liveKey: null }));
        return { ok: true, challenge };
      }
      const account = await this.updateAccount(challenge.contactId, (current) => ({ ...current, wrong: current.wrong + 1 }));
      const attempts = challenge.attempts + 1;
      if (attempts >= MAX_ATTEMPTS || account.wrong >= MAX_WRONG_PER_WINDOW) {
        await this.kv.delete(keyFor(token));
        return { ok: false, reason: 'locked' };
      }
      await this.kv.set(keyFor(token), { ...challenge, attempts });
      return { ok: false, reason: 'bad_code', attemptsLeft: MAX_ATTEMPTS - attempts };
    });
  }

  private newCode(): string {
    return this.fixedCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  private async load(token: string): Promise<OtpChallenge | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const challenge = await this.kv.get<OtpChallenge>(keyFor(token));
    if (!challenge) return null;
    if (Date.parse(challenge.expiresAt) <= Date.now()) {
      await this.kv.delete(keyFor(token));
      return null;
    }
    return challenge;
  }

  private async loadAccount(contactId: number): Promise<OtpAccount> {
    const account = await this.kv.get<OtpAccount>(accountKey(contactId));
    if (account && Date.now() - Date.parse(account.windowStart) < ACCOUNT_WINDOW_MS) return account;
    // A new hour forgives the counts, never the live challenge.
    return { windowStart: new Date().toISOString(), challenges: 0, wrong: 0, liveKey: account?.liveKey ?? null };
  }

  private async updateAccount(contactId: number, change: (account: OtpAccount) => OtpAccount): Promise<OtpAccount> {
    return this.exclusive(accountKey(contactId), async () => {
      const next = change(await this.loadAccount(contactId));
      await this.kv.set(accountKey(contactId), next);
      return next;
    });
  }

  private async exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.busy.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.busy.set(key, current);
    try {
      return await current;
    } finally {
      if (this.busy.get(key) === current) this.busy.delete(key);
    }
  }
}

/** `sa***@gmail.com`: enough to recognise the mailbox on the sign-in page. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***';
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}
