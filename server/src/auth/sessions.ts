import { createHash, randomBytes } from 'node:crypto';

import type { KV } from '../store.js';

/** An app session: the hub-side visitor uuid the server logged in with, never shown to the app. */
export type SessionRecord = {
  uuid: string;
  contactId: number;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  /** Set when the session started with the dashboard's e-mailed code (M18). */
  adminVerifiedAt?: string;
};

/** A registration (or unverified login) waiting for the e-mail code. */
export type PendingRecord = {
  uuid: string;
  email: string;
  createdAt: string;
  expiresAt: string;
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const PENDING_MINUTES = 30;
const TOUCH_INTERVAL_MS = 60 * 60_000;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function keyFor(prefix: 'session' | 'pending', token: string): string {
  return `${prefix}:${createHash('sha256').update(token).digest('hex')}`;
}

/** Tokens are stored hashed: a database leak does not leak usable sessions. */
export class SessionStore {
  constructor(
    private readonly kv: KV,
    private readonly sessionDays: number,
  ) {}

  async createSession(uuid: string, contactId: number, adminVerified = false): Promise<string> {
    const token = newToken();
    const now = new Date();
    const record: SessionRecord = {
      uuid,
      contactId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.sessionDays * 86_400_000).toISOString(),
      lastSeenAt: now.toISOString(),
      ...(adminVerified ? { adminVerifiedAt: now.toISOString() } : {}),
    };
    await this.kv.set(keyFor('session', token), record);
    return token;
  }

  async getSession(token: string): Promise<SessionRecord | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const key = keyFor('session', token);
    const record = await this.kv.get<SessionRecord>(key);
    if (!record) return null;
    if (Date.parse(record.expiresAt) <= Date.now()) {
      await this.kv.delete(key);
      return null;
    }
    if (Date.now() - Date.parse(record.lastSeenAt) > TOUCH_INTERVAL_MS) {
      record.lastSeenAt = new Date().toISOString();
      await this.kv.set(key, record);
    }
    return record;
  }

  async deleteSession(token: string): Promise<void> {
    if (TOKEN_PATTERN.test(token)) await this.kv.delete(keyFor('session', token));
  }

  async createPending(uuid: string, email: string): Promise<string> {
    const token = newToken();
    const now = new Date();
    const record: PendingRecord = {
      uuid,
      email,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PENDING_MINUTES * 60_000).toISOString(),
    };
    await this.kv.set(keyFor('pending', token), record);
    return token;
  }

  async getPending(token: string): Promise<PendingRecord | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const key = keyFor('pending', token);
    const record = await this.kv.get<PendingRecord>(key);
    if (!record) return null;
    if (Date.parse(record.expiresAt) <= Date.now()) {
      await this.kv.delete(key);
      return null;
    }
    return record;
  }

  async deletePending(token: string): Promise<void> {
    if (TOKEN_PATTERN.test(token)) await this.kv.delete(keyFor('pending', token));
  }
}
