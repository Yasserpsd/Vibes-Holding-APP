import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import type { KV } from '../store.js';
import type { Persona } from './service.js';

/**
 * M101 «تغيير التوجه»: a member changes his persona from inside the app with an e-mailed code,
 * once every 30 days. Club admins are exempt (they switch directly through PATCH /api/me, no code,
 * no cooldown) so the owner can demo the neutral / entrepreneur / investor apps freely.
 */
export type PersonaRequest = {
  persona: Persona;
  /** sha256 of contactId and the code, so the stored row alone cannot be searched for the code. */
  codeHash: string;
  codeExpiresAt: string;
  attempts: number;
  sends: number;
  lastSentAt: string;
};

export const PERSONA_CHANGE_DAYS = 30;
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 4;
const RESEND_GAP_SECONDS = 20;

export type PersonaRequestResult =
  | { ok: true; seconds: number }
  | { ok: false; reason: 'cooldown'; daysLeft: number }
  | { ok: false; reason: 'too_soon'; waitSeconds: number }
  | { ok: false; reason: 'too_many' };

export type PersonaConfirmResult =
  | { ok: true; persona: Persona }
  | { ok: false; reason: 'gone' | 'code_expired' | 'locked' }
  | { ok: false; reason: 'bad_code'; attemptsLeft: number };

/** Mails the code; a throw means no mail left and nothing about the request changes. */
export type PersonaDeliver = (code: string) => Promise<void>;

const requestKey = (contactId: number): string => `persona-change:${contactId}`;
const stampKey = (contactId: number): string => `persona-changed:${contactId}`;

function hashCode(contactId: number, code: string): string {
  return createHash('sha256').update(`${contactId}:${code}`).digest('hex');
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class PersonaChangeStore {
  constructor(
    private readonly kv: KV,
    /** Local runs on the mock hub without SMTP: the mock's public test code, since no mail can arrive. */
    private readonly fixedCode: string | null = null,
  ) {}

  /** Days until the member may change again; 0 when the window is open (admins never ask). */
  async daysLeft(contactId: number): Promise<number> {
    const stamp = await this.kv.get<{ at: string }>(stampKey(contactId));
    if (!stamp) return 0;
    const elapsed = Date.now() - Date.parse(stamp.at);
    const windowMs = PERSONA_CHANGE_DAYS * 24 * 60 * 60_000;
    return elapsed >= windowMs ? 0 : Math.max(1, Math.ceil((windowMs - elapsed) / (24 * 60 * 60_000)));
  }

  async request(contactId: number, persona: Persona, deliver: PersonaDeliver): Promise<PersonaRequestResult> {
    const daysLeft = await this.daysLeft(contactId);
    if (daysLeft > 0) return { ok: false, reason: 'cooldown', daysLeft };
    const existing = await this.kv.get<PersonaRequest>(requestKey(contactId));
    const now = Date.now();
    if (existing && Date.parse(existing.codeExpiresAt) > now) {
      if (existing.sends >= MAX_SENDS) return { ok: false, reason: 'too_many' };
      const waitMs = Date.parse(existing.lastSentAt) + RESEND_GAP_SECONDS * 1000 - now;
      if (waitMs > 0) return { ok: false, reason: 'too_soon', waitSeconds: Math.ceil(waitMs / 1000) };
    }
    const code = this.fixedCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    await deliver(code);
    const request: PersonaRequest = {
      persona,
      codeHash: hashCode(contactId, code),
      codeExpiresAt: new Date(now + CODE_MINUTES * 60_000).toISOString(),
      attempts: existing && Date.parse(existing.codeExpiresAt) > now ? existing.attempts : 0,
      sends: existing && Date.parse(existing.codeExpiresAt) > now ? existing.sends + 1 : 1,
      lastSentAt: new Date(now).toISOString(),
    };
    await this.kv.set(requestKey(contactId), request);
    return { ok: true, seconds: CODE_MINUTES * 60 };
  }

  /** A right code ends the request (single use); the caller then applies the persona at the hub and stamps. */
  async confirm(contactId: number, code: string): Promise<PersonaConfirmResult> {
    const request = await this.kv.get<PersonaRequest>(requestKey(contactId));
    if (!request) return { ok: false, reason: 'gone' };
    if (Date.parse(request.codeExpiresAt) <= Date.now()) {
      await this.kv.delete(requestKey(contactId));
      return { ok: false, reason: 'code_expired' };
    }
    if (sameHash(request.codeHash, hashCode(contactId, code))) {
      await this.kv.delete(requestKey(contactId));
      return { ok: true, persona: request.persona };
    }
    const attempts = request.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.kv.delete(requestKey(contactId));
      return { ok: false, reason: 'locked' };
    }
    await this.kv.set(requestKey(contactId), { ...request, attempts });
    return { ok: false, reason: 'bad_code', attemptsLeft: MAX_ATTEMPTS - attempts };
  }

  /** The change landed at the hub: the 30-day window starts now. */
  async stamp(contactId: number): Promise<void> {
    await this.kv.set(stampKey(contactId), { at: new Date().toISOString() });
  }
}
