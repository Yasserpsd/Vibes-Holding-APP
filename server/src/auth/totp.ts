import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { KV } from '../store.js';

/**
 * M140 (owner, 2026-10-28): a second factor with any authenticator app (Google Authenticator, Microsoft
 * Authenticator, Authy, 1Password…). RFC 6238 TOTP, 30-second steps, 6 digits, SHA-1 — what every such
 * app expects from an `otpauth://` link. Members may switch it on («حماية إضافية»); dashboard accounts
 * must, while ADMIN_TOTP=1. The secret stays on the server (kv) and in the member's app; it never travels
 * again after enrolment. Backup codes are stored hashed and burn on use.
 */

export const TOTP_ISSUER = 'Investors Club';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** How long a sign-in or an enrolment may wait for the code. */
export const TOTP_TOKEN_SECONDS = 5 * 60;
export const BACKUP_CODES = 8;
const MAX_ATTEMPTS = 5;
/** One step either side: a phone clock a little off still signs in. */
const WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The 6-digit code of one time step (RFC 4226 dynamic truncation over HMAC-SHA1). */
export function hotp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function stepOf(now = Date.now()): number {
  return Math.floor(now / (TOTP_STEP_SECONDS * 1000));
}

/** The code an authenticator shows right now — the tests and the probe scripts use it; sign-in uses `matchStep`. */
export function totpCode(secret: string, now = Date.now()): string {
  return hotp(secret, stepOf(now));
}

/** The step the code belongs to, within the window, or null; a step at or before `after` is a replay and never matches. */
export function matchStep(secret: string, code: string, after: number, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepOf(now);
  for (let delta = -WINDOW; delta <= WINDOW; delta += 1) {
    const step = current + delta;
    if (step <= after) continue;
    if (safeEqual(hotp(secret, step), code)) return step;
  }
  return null;
}

/** What the authenticator app scans or opens: the issuer and the account's e-mail label the entry. */
export function otpauthUri(email: string, secret: string): string {
  // The label keeps its literal colon (issuer:account), the form every authenticator app expects.
  const label = `${encodeURIComponent(TOTP_ISSUER)}:${encodeURIComponent(email)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hashOf(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function newBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODES }, () => {
    const raw = base32Encode(randomBytes(5)).slice(0, 8);
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

export function normalizeBackup(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The account's authenticator: the shared secret, the last step that signed in (replay guard) and the hashed backup codes. */
export type TotpRecord = {
  secret: string;
  enabledAt: string;
  lastStep: number;
  backup: string[];
};

export type TotpAudience = 'app' | 'dashboard';

/** An enrolment waiting for its first code: the secret is live only once that code proves the app holds it. */
type SetupRecord = {
  contactId: number;
  uuid: string | null;
  secret: string;
  audience: TotpAudience;
  adminVerified: boolean;
  attempts: number;
  expiresAt: string;
};

/** A sign-in whose password (and e-mailed code) passed and that waits for the authenticator code. */
type StepRecord = {
  contactId: number;
  uuid: string;
  audience: TotpAudience;
  adminVerified: boolean;
  attempts: number;
  expiresAt: string;
};

export type TotpStatus = { enabled: boolean; enabledAt: string | null; backupLeft: number };
export type TotpFailure = 'gone' | 'bad_code' | 'locked';
export type SetupDone = { ok: true; contactId: number; uuid: string | null; audience: TotpAudience; adminVerified: boolean; backupCodes: string[] };
export type StepDone = { ok: true; contactId: number; uuid: string; audience: TotpAudience; adminVerified: boolean };
export type Verified = { ok: true; via: 'code' | 'backup' } | { ok: false; reason: 'bad_code' | 'none' };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export class TotpStore {
  constructor(private readonly kv: KV) {}

  private recordKey(contactId: number): string {
    return `totp:${contactId}`;
  }

  private tokenKey(kind: 'setup' | 'step', token: string): string {
    return `totp-${kind}:${hashOf(token)}`;
  }

  async get(contactId: number): Promise<TotpRecord | null> {
    return (await this.kv.get<TotpRecord>(this.recordKey(contactId))) ?? null;
  }

  async enabled(contactId: number): Promise<boolean> {
    return (await this.get(contactId)) !== null;
  }

  async status(contactId: number): Promise<TotpStatus> {
    const record = await this.get(contactId);
    return { enabled: record !== null, enabledAt: record?.enabledAt ?? null, backupLeft: record?.backup.length ?? 0 };
  }

  /** Starts an enrolment (first time, or a new phone): the secret goes to the app once, the record changes only on `completeSetup`. */
  async beginSetup(contactId: number, uuid: string | null, audience: TotpAudience, adminVerified = false): Promise<{ token: string; secret: string }> {
    const token = newToken();
    const secret = newSecret();
    const record: SetupRecord = { contactId, uuid, secret, audience, adminVerified, attempts: 0, expiresAt: expiry() };
    await this.kv.set(this.tokenKey('setup', token), record);
    return { token, secret };
  }

  /** The first code proves the authenticator holds the secret: the record goes live with fresh backup codes. */
  async completeSetup(token: string, code: string, now = Date.now()): Promise<SetupDone | { ok: false; reason: TotpFailure }> {
    if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: 'gone' };
    const key = this.tokenKey('setup', token);
    const setup = await this.kv.get<SetupRecord>(key);
    if (!setup || Date.parse(setup.expiresAt) <= now) {
      await this.kv.delete(key);
      return { ok: false, reason: 'gone' };
    }
    const step = matchStep(setup.secret, code, -1, now);
    if (step === null) {
      setup.attempts += 1;
      if (setup.attempts >= MAX_ATTEMPTS) {
        await this.kv.delete(key);
        return { ok: false, reason: 'locked' };
      }
      await this.kv.set(key, setup);
      return { ok: false, reason: 'bad_code' };
    }
    const backupCodes = newBackupCodes();
    const record: TotpRecord = { secret: setup.secret, enabledAt: new Date(now).toISOString(), lastStep: step, backup: backupCodes.map(hashOf) };
    await this.kv.set(this.recordKey(setup.contactId), record);
    await this.kv.delete(key);
    return { ok: true, contactId: setup.contactId, uuid: setup.uuid, audience: setup.audience, adminVerified: setup.adminVerified, backupCodes };
  }

  /** A sign-in that passed its earlier factors waits here for the authenticator code. */
  async beginStep(contactId: number, uuid: string, audience: TotpAudience, adminVerified = false): Promise<string> {
    const token = newToken();
    const record: StepRecord = { contactId, uuid, audience, adminVerified, attempts: 0, expiresAt: expiry() };
    await this.kv.set(this.tokenKey('step', token), record);
    return token;
  }

  async checkStep(token: string, code: string, now = Date.now()): Promise<StepDone | { ok: false; reason: TotpFailure }> {
    if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: 'gone' };
    const key = this.tokenKey('step', token);
    const step = await this.kv.get<StepRecord>(key);
    if (!step || Date.parse(step.expiresAt) <= now) {
      await this.kv.delete(key);
      return { ok: false, reason: 'gone' };
    }
    const verified = await this.verify(step.contactId, code, now);
    if (!verified.ok) {
      step.attempts += 1;
      if (step.attempts >= MAX_ATTEMPTS) {
        await this.kv.delete(key);
        return { ok: false, reason: 'locked' };
      }
      await this.kv.set(key, step);
      return { ok: false, reason: 'bad_code' };
    }
    await this.kv.delete(key);
    return { ok: true, contactId: step.contactId, uuid: step.uuid, audience: step.audience, adminVerified: step.adminVerified };
  }

  /** An authenticator code (never the same step twice) or an unused backup code, which burns. */
  async verify(contactId: number, code: string, now = Date.now()): Promise<Verified> {
    const record = await this.get(contactId);
    if (!record) return { ok: false, reason: 'none' };
    const trimmed = code.trim();
    const step = matchStep(record.secret, trimmed, record.lastStep, now);
    if (step !== null) {
      record.lastStep = step;
      await this.kv.set(this.recordKey(contactId), record);
      return { ok: true, via: 'code' };
    }
    const normalized = normalizeBackup(trimmed);
    if (normalized.length === 8) {
      const hash = hashOf(`${normalized.slice(0, 4)}-${normalized.slice(4)}`);
      const index = record.backup.findIndex((entry) => safeEqual(entry, hash));
      if (index >= 0) {
        record.backup.splice(index, 1);
        await this.kv.set(this.recordKey(contactId), record);
        return { ok: true, via: 'backup' };
      }
    }
    return { ok: false, reason: 'bad_code' };
  }

  /** New backup codes replace the old set; the authenticator itself stays. */
  async regenerateBackup(contactId: number): Promise<string[] | null> {
    const record = await this.get(contactId);
    if (!record) return null;
    const backupCodes = newBackupCodes();
    record.backup = backupCodes.map(hashOf);
    await this.kv.set(this.recordKey(contactId), record);
    return backupCodes;
  }

  async disable(contactId: number): Promise<void> {
    await this.kv.delete(this.recordKey(contactId));
  }
}

function expiry(): string {
  return new Date(Date.now() + TOTP_TOKEN_SECONDS * 1000).toISOString();
}
