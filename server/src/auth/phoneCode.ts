import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import type { KV } from '../store.js';
import { newToken } from './sessions.js';

/**
 * M203 (owner, 2026-11-06): WhatsApp is the proof of identity. A code step stands between a right
 * password (or a Google/Apple identity) and the session, and before a new number is saved.
 * `signin` = a member signing in; `number` = a signed-in member proving a new number.
 */
export type PhoneCodePurpose = 'signin' | 'number';
export type PhoneCodeVia = 'whatsapp' | 'email';

export type PhoneCodeStep = {
  purpose: PhoneCodePurpose;
  uuid: string;
  contactId: number;
  /** The number the code goes to, as the hub spells it. */
  phone: string;
  /** `number` only: what the hub stores once the code is right. */
  newPhone?: string;
  country?: string;
  /** Where the fallback code goes. */
  email: string;
  lang: string;
  via: PhoneCodeVia;
  codeHash: string;
  codeExpiresAt: string;
  attempts: number;
  sends: number;
  lastSentAt: string;
  expiresAt: string;
};

/** Sends the code on one channel; false = it did not leave (nothing about the step changes on a false e-mail). */
export type PhoneCodeSend = (via: PhoneCodeVia, step: Pick<PhoneCodeStep, 'phone' | 'email' | 'lang'>, code: string) => Promise<boolean>;

type PhoneCodeAccount = { windowStart: string; steps: number; wrong: number; liveKey: string | null };

export type PhoneCodeBegin = { ok: true; token: string; via: PhoneCodeVia } | { ok: false; reason: 'cooldown'; waitSeconds: number } | { ok: false; reason: 'send_failed' };
export type PhoneCodeResend = { ok: true; via: PhoneCodeVia } | { ok: false; reason: 'gone' | 'too_many' | 'send_failed' } | { ok: false; reason: 'too_soon'; waitSeconds: number };
export type PhoneCodeCheck = { ok: true; step: PhoneCodeStep } | { ok: false; reason: 'gone' | 'locked' | 'code_expired' } | { ok: false; reason: 'bad_code'; attemptsLeft: number };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
/** The step and the code live as long as the hub's sign-up window is short: ten minutes. */
export const PHONE_CODE_SECONDS = 10 * 60;
/** The gap before «إعادة الإرسال» on WhatsApp; each code is a paid message. */
export const PHONE_CODE_RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 4;
const ACCOUNT_WINDOW_MS = 60 * 60_000;
const MAX_STEPS_PER_WINDOW = 6;
const MAX_WRONG_PER_WINDOW = 10;

const keyFor = (token: string): string => `phone-code:${createHash('sha256').update(token).digest('hex')}`;
const accountKey = (contactId: number): string => `phone-code-account:${contactId}`;
const hashCode = (token: string, code: string): string => createHash('sha256').update(`${token}:${code}`).digest('hex');

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `•••123`: what the app shows of a number. */
export function maskNumber(phone: string): string {
  return `•••${String(phone).replace(/\D+/g, '').slice(-3)}`;
}

/**
 * The code is kept hashed, works once and dies after five wrong tries. It always goes to WhatsApp first; when Meta refuses
 * (or a number hit the three-an-hour limit) it goes to the e-mail, and the step remembers the channel, because only a code
 * that travelled on WhatsApp proves the number. An account has one live step and an hourly budget, so a right password
 * cannot buy endless paid messages. The code itself is never logged.
 */
export class PhoneCodeStore {
  /** The KV has no atomic counter: parallel guesses must not share one attempt. */
  private readonly busy = new Map<string, Promise<unknown>>();

  constructor(
    private readonly kv: KV,
    private readonly send: PhoneCodeSend,
  ) {}

  async begin(input: Pick<PhoneCodeStep, 'purpose' | 'uuid' | 'contactId' | 'phone' | 'newPhone' | 'country' | 'email' | 'lang'>): Promise<PhoneCodeBegin> {
    return this.exclusive(accountKey(input.contactId), async () => {
      const account = await this.loadAccount(input.contactId);
      if (account.steps >= MAX_STEPS_PER_WINDOW || account.wrong >= MAX_WRONG_PER_WINDOW) {
        return { ok: false, reason: 'cooldown', waitSeconds: Math.max(1, Math.ceil((Date.parse(account.windowStart) + ACCOUNT_WINDOW_MS - Date.now()) / 1000)) };
      }
      if (account.liveKey) await this.kv.delete(account.liveKey);
      const spent: PhoneCodeAccount = { ...account, steps: account.steps + 1, liveKey: null };
      await this.kv.set(accountKey(input.contactId), spent);
      const token = newToken();
      const code = this.newCode();
      const via = await this.deliver('whatsapp', input, code);
      if (!via) return { ok: false, reason: 'send_failed' };
      const now = Date.now();
      await this.kv.set(keyFor(token), {
        ...input,
        via,
        codeHash: hashCode(token, code),
        codeExpiresAt: new Date(now + PHONE_CODE_SECONDS * 1000).toISOString(),
        attempts: 0,
        sends: 1,
        lastSentAt: new Date(now).toISOString(),
        expiresAt: new Date(now + PHONE_CODE_SECONDS * 1000).toISOString(),
      } satisfies PhoneCodeStep);
      await this.kv.set(accountKey(input.contactId), { ...spent, liveKey: keyFor(token) });
      return { ok: true, token, via };
    });
  }

  /** A new code replaces the old one. `email` is the member's own way out: wrong number, or no WhatsApp on it. */
  async resend(token: string, channel: PhoneCodeVia): Promise<PhoneCodeResend> {
    return this.exclusive(keyFor(token), async () => {
      const step = await this.load(token);
      if (!step) return { ok: false, reason: 'gone' };
      if (step.sends >= MAX_SENDS) return { ok: false, reason: 'too_many' };
      // The gap guards the paid channel; a member leaving for the e-mail never waits.
      const waitMs = Date.parse(step.lastSentAt) + PHONE_CODE_RESEND_SECONDS * 1000 - Date.now();
      if (channel === 'whatsapp' && waitMs > 0) return { ok: false, reason: 'too_soon', waitSeconds: Math.ceil(waitMs / 1000) };
      const code = this.newCode();
      const via = await this.deliver(channel, step, code);
      if (!via) return { ok: false, reason: 'send_failed' };
      const now = Date.now();
      await this.kv.set(keyFor(token), {
        ...step,
        via,
        codeHash: hashCode(token, code),
        codeExpiresAt: new Date(now + PHONE_CODE_SECONDS * 1000).toISOString(),
        expiresAt: new Date(now + PHONE_CODE_SECONDS * 1000).toISOString(),
        sends: step.sends + 1,
        lastSentAt: new Date(now).toISOString(),
      } satisfies PhoneCodeStep);
      return { ok: true, via };
    });
  }

  async check(token: string, code: string): Promise<PhoneCodeCheck> {
    return this.exclusive(keyFor(token), async () => {
      const step = await this.load(token);
      if (!step) return { ok: false, reason: 'gone' };
      if (Date.parse(step.codeExpiresAt) <= Date.now()) return { ok: false, reason: 'code_expired' };
      if (sameHash(step.codeHash, hashCode(token, code))) {
        await this.kv.delete(keyFor(token));
        await this.updateAccount(step.contactId, (account) => ({ ...account, liveKey: null }));
        return { ok: true, step };
      }
      const account = await this.updateAccount(step.contactId, (current) => ({ ...current, wrong: current.wrong + 1 }));
      const attempts = step.attempts + 1;
      if (attempts >= MAX_ATTEMPTS || account.wrong >= MAX_WRONG_PER_WINDOW) {
        await this.kv.delete(keyFor(token));
        return { ok: false, reason: 'locked' };
      }
      await this.kv.set(keyFor(token), { ...step, attempts });
      return { ok: false, reason: 'bad_code', attemptsLeft: MAX_ATTEMPTS - attempts };
    });
  }

  /** The step's owner and target, for the routes that must compare them. Null when it is gone. */
  peek(token: string): Promise<PhoneCodeStep | null> {
    return this.load(token);
  }

  /** WhatsApp, then the e-mail; `email` goes straight there. Null = neither channel took it. */
  private async deliver(channel: PhoneCodeVia, step: Pick<PhoneCodeStep, 'phone' | 'email' | 'lang'>, code: string): Promise<PhoneCodeVia | null> {
    if (channel === 'whatsapp' && (await this.send('whatsapp', step, code))) return 'whatsapp';
    return (await this.send('email', step, code)) ? 'email' : null;
  }

  private newCode(): string {
    return String(randomInt(1000, 10_000));
  }

  private async load(token: string): Promise<PhoneCodeStep | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const step = await this.kv.get<PhoneCodeStep>(keyFor(token));
    if (!step) return null;
    if (Date.parse(step.expiresAt) <= Date.now()) {
      await this.kv.delete(keyFor(token));
      return null;
    }
    return step;
  }

  private async loadAccount(contactId: number): Promise<PhoneCodeAccount> {
    const account = await this.kv.get<PhoneCodeAccount>(accountKey(contactId));
    if (account && Date.now() - Date.parse(account.windowStart) < ACCOUNT_WINDOW_MS) return account;
    return { windowStart: new Date().toISOString(), steps: 0, wrong: 0, liveKey: account?.liveKey ?? null };
  }

  private async updateAccount(contactId: number, change: (account: PhoneCodeAccount) => PhoneCodeAccount): Promise<PhoneCodeAccount> {
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
