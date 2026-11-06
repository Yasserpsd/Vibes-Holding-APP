import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import type { KV } from '../store.js';
import { newToken } from './sessions.js';

/**
 * M203 (owner, 2026-11-06): WhatsApp is the proof of identity. A code step stands between a right
 * password (or a Google/Apple identity) and the session, and before a new number is saved.
 * `signin` = a member signing in; `number` = a signed-in member proving a new number.
 */
export type PhoneCodePurpose = 'signin' | 'number';
/** M204: WhatsApp first, always. `email` = WhatsApp did not carry this code, so it went to the account's address by itself. */
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
  /** The account's address: the code goes there only when WhatsApp did not carry it. */
  email: string;
  lang: string;
  via: PhoneCodeVia;
  /** M209: how many digits this step's code has — 6 for a bundle that says `code6`, 4 for older ones (and steps from before M209). */
  digits?: 4 | 6;
  codeHash: string;
  /** Set when the code was replaced from Meta's webhook, where the step's token is not known. */
  salt?: string;
  /** Meta's id of the WhatsApp message that carries the live code. */
  waMessageId?: string;
  /** Meta reported this number unreachable: the next codes go straight to the e-mail. */
  unreachable?: boolean;
  codeExpiresAt: string;
  attempts: number;
  sends: number;
  lastSentAt: string;
  expiresAt: string;
};

/** Sends the code on one channel; `sent: false` = it did not leave. `messageId` = Meta's id, to follow its delivery. */
export type PhoneCodeSend = (via: PhoneCodeVia, step: Pick<PhoneCodeStep, 'phone' | 'email' | 'lang'>, code: string) => Promise<{ sent: boolean; messageId?: string }>;

/** M204: the dashboard vouched for this account's number; it signs in without the WhatsApp code. */
export type PhoneCodeWaiver = { by: string; at: string };

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
const waiverKey = (contactId: number): string => `phone-code-waived:${contactId}`;
const messageKey = (messageId: string): string => `phone-code-message:${createHash('sha256').update(messageId).digest('hex')}`;
const hashCode = (token: string, code: string): string => createHash('sha256').update(`${token}:${code}`).digest('hex');

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Only the sign-in code may fall to the e-mail. A number proving itself, the registered one or a new one, is the step
 * the e-mail cannot stand in for (a mailed code proves nothing about the number). Owner, 2026-11-06: the member may
 * change his number himself whenever he likes, «اهم حاجه لما يغير الرقم يجيله كود علي واتس اب»: when WhatsApp cannot
 * carry that code the step fails, and he types another number or reaches support.
 */
const mayMail = (step: Pick<PhoneCodeStep, 'purpose'>): boolean => step.purpose === 'signin';

/** `•••123`: what the app shows of a number. */
export function maskNumber(phone: string): string {
  return `•••${String(phone).replace(/\D+/g, '').slice(-3)}`;
}

/**
 * The code is kept hashed, works once and dies after five wrong tries. M204 (owner, 2026-11-06: «خلي اوتوماتيك اي عملية
 * عموما متنفذتش واتس اب تتبعت ايميل… في حالات ضيقة جدا»): it always goes to WhatsApp first and the member has no e-mail
 * button; the e-mail carries it BY ITSELF only when Meta refuses the send or reports later that the message was not
 * delivered (`deliveryFailed`). The step remembers the channel, because only a code that travelled on WhatsApp proves
 * the number. An admin can also vouch for a number (`waive`). An account has one live step and an hourly budget, so a
 * right password cannot buy endless paid messages. The code itself is never logged.
 */
export class PhoneCodeStore {
  /** The KV has no atomic counter: parallel guesses must not share one attempt. */
  private readonly busy = new Map<string, Promise<unknown>>();

  constructor(
    private readonly kv: KV,
    private readonly send: PhoneCodeSend,
  ) {}

  async begin(input: Pick<PhoneCodeStep, 'purpose' | 'uuid' | 'contactId' | 'phone' | 'newPhone' | 'country' | 'email' | 'lang' | 'digits'>): Promise<PhoneCodeBegin> {
    return this.exclusive(accountKey(input.contactId), async () => {
      const account = await this.loadAccount(input.contactId);
      if (account.steps >= MAX_STEPS_PER_WINDOW || account.wrong >= MAX_WRONG_PER_WINDOW) {
        return { ok: false, reason: 'cooldown', waitSeconds: Math.max(1, Math.ceil((Date.parse(account.windowStart) + ACCOUNT_WINDOW_MS - Date.now()) / 1000)) };
      }
      if (account.liveKey) await this.drop(account.liveKey);
      const spent: PhoneCodeAccount = { ...account, steps: account.steps + 1, liveKey: null };
      await this.kv.set(accountKey(input.contactId), spent);
      const token = newToken();
      const code = this.newCode(input.digits);
      const sent = await this.deliver(input, code);
      if (!sent) return { ok: false, reason: 'send_failed' };
      const via = sent.via;
      const now = Date.now();
      if (sent.messageId) await this.kv.set(messageKey(sent.messageId), { key: keyFor(token) });
      await this.kv.set(keyFor(token), {
        ...input,
        via,
        ...(sent.messageId ? { waMessageId: sent.messageId } : {}),
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

  /** A new code replaces the old one: WhatsApp again, unless Meta already reported the number unreachable. */
  async resend(token: string): Promise<PhoneCodeResend> {
    return this.exclusive(keyFor(token), async () => {
      const step = await this.load(token);
      if (!step) return { ok: false, reason: 'gone' };
      if (step.sends >= MAX_SENDS) return { ok: false, reason: 'too_many' };
      // The gap guards the paid channel.
      const waitMs = Date.parse(step.lastSentAt) + PHONE_CODE_RESEND_SECONDS * 1000 - Date.now();
      if (waitMs > 0) return { ok: false, reason: 'too_soon', waitSeconds: Math.ceil(waitMs / 1000) };
      const code = this.newCode(step.digits);
      const sent = await this.deliver(step, code);
      if (!sent) return { ok: false, reason: 'send_failed' };
      const via = sent.via;
      const now = Date.now();
      if (step.waMessageId) await this.kv.delete(messageKey(step.waMessageId));
      if (sent.messageId) await this.kv.set(messageKey(sent.messageId), { key: keyFor(token) });
      const { salt: _salt, waMessageId: _old, ...kept } = step;
      await this.kv.set(keyFor(token), {
        ...kept,
        via,
        ...(sent.messageId ? { waMessageId: sent.messageId } : {}),
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
      if (sameHash(step.codeHash, hashCode(step.salt ?? token, code))) {
        await this.drop(keyFor(token));
        await this.updateAccount(step.contactId, (account) => ({ ...account, liveKey: null }));
        return { ok: true, step };
      }
      const account = await this.updateAccount(step.contactId, (current) => ({ ...current, wrong: current.wrong + 1 }));
      const attempts = step.attempts + 1;
      if (attempts >= MAX_ATTEMPTS || account.wrong >= MAX_WRONG_PER_WINDOW) {
        await this.drop(keyFor(token));
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

  /**
   * Meta's webhook: the WhatsApp message with a live code was not delivered (no WhatsApp on the number, 131026…).
   * A NEW code goes to the account's e-mail by itself and the step turns to `email`. True = a code was mailed.
   */
  async deliveryFailed(messageId: string): Promise<boolean> {
    const link = await this.kv.get<{ key: string }>(messageKey(messageId));
    if (!link) return false;
    await this.kv.delete(messageKey(messageId));
    return this.exclusive(link.key, async () => {
      const step = await this.kv.get<PhoneCodeStep>(link.key);
      if (!step || step.waMessageId !== messageId || Date.parse(step.expiresAt) <= Date.now()) return false;
      const code = this.newCode(step.digits);
      const salt = newToken();
      const { waMessageId: _old, ...kept } = step;
      if (!mayMail(step) || !(await this.send('email', step, code)).sent) {
        await this.kv.set(link.key, { ...kept, unreachable: true } satisfies PhoneCodeStep);
        return false;
      }
      const now = Date.now();
      await this.kv.set(link.key, {
        ...kept,
        via: 'email',
        unreachable: true,
        salt,
        codeHash: hashCode(salt, code),
        codeExpiresAt: new Date(now + PHONE_CODE_SECONDS * 1000).toISOString(),
        expiresAt: new Date(now + PHONE_CODE_SECONDS * 1000).toISOString(),
      } satisfies PhoneCodeStep);
      return true;
    });
  }

  /** WhatsApp first; the e-mail only when it refuses, or when Meta already said the number is unreachable. Null = nothing left. */
  private async deliver(step: Pick<PhoneCodeStep, 'purpose' | 'newPhone' | 'phone' | 'email' | 'lang' | 'unreachable'>, code: string): Promise<{ via: PhoneCodeVia; messageId?: string } | null> {
    if (!step.unreachable) {
      const onWhatsapp = await this.send('whatsapp', step, code);
      if (onWhatsapp.sent) return { via: 'whatsapp', ...(onWhatsapp.messageId ? { messageId: onWhatsapp.messageId } : {}) };
    }
    if (!mayMail(step)) return null;
    return (await this.send('email', step, code)).sent ? { via: 'email' } : null;
  }

  /** Removes a step together with the link from its WhatsApp message. */
  private async drop(key: string): Promise<void> {
    const step = await this.kv.get<PhoneCodeStep>(key);
    if (step?.waMessageId) await this.kv.delete(messageKey(step.waMessageId));
    await this.kv.delete(key);
  }

  /** M204: a member the code cannot reach wrote to support; the admin who checked him vouches for the number. */
  async waive(contactId: number, by: string): Promise<PhoneCodeWaiver> {
    const waiver: PhoneCodeWaiver = { by, at: new Date().toISOString() };
    await this.kv.set(waiverKey(contactId), waiver);
    return waiver;
  }

  async unwaive(contactId: number): Promise<void> {
    await this.kv.delete(waiverKey(contactId));
  }

  async waiver(contactId: number): Promise<PhoneCodeWaiver | null> {
    return (await this.kv.get<PhoneCodeWaiver>(waiverKey(contactId))) ?? null;
  }

  private newCode(digits: 4 | 6 = 4): string {
    return digits === 6 ? String(randomInt(100_000, 1_000_000)) : String(randomInt(1000, 10_000));
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
