import { createHash, randomBytes } from 'node:crypto';

import type { KV } from '../store.js';
import type { SessionDevice, SessionPlatform } from './device.js';

/** An app session: the hub-side visitor uuid the server logged in with, never shown to the app. */
export type SessionRecord = {
  uuid: string;
  contactId: number;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  /**
   * M264 «الجلسات المسجلة»: the session's public id — what the member's list names a device by. It is a one-way
   * digest of the stored (already hashed) key, so it is never the token and cannot lead back to it. A session from
   * before M264 has none of the fields below until its next request.
   */
  sid?: string;
  /** The address the session was started from (absent on sessions older than M264). */
  ip?: string;
  /** The address of its latest request. */
  lastIp?: string;
  platform?: SessionPlatform;
  appVersion?: string;
  /** Set when the session started with the dashboard's e-mailed code (M18). */
  adminVerifiedAt?: string;
  /** Set when the dashboard sign-in ticked «تذكرني»: the e-mailed code stays valid for ADMIN_REMEMBER_DAYS instead of ADMIN_SESSION_HOURS. */
  adminRemember?: boolean;
  /** M140: set when the session started with the account's authenticator code (or its enrolment). */
  totpVerifiedAt?: string;
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
/** M216: contacts deleted from the dashboard; their sessions end on the spot. Ids never return (the hub keeps the emptied row). */
const ENDED_CONTACTS_KEY = 'session:endedContacts';

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function keyFor(prefix: 'session' | 'pending', token: string): string {
  return `${prefix}:${createHash('sha256').update(token).digest('hex')}`;
}

/** M264: one line per live session of a contact — its public id and the stored key (the token's hash, never the token). */
type IndexEntry = { sid: string; key: string };
const INDEX_PRUNE_AT = 20;
/** M264: «sign out of all other devices» — per contact, the moment of the press and the one session that stays. */
type Cutoff = { before: string; keep: string };
const CUTOFFS_KEY = 'session:cutoffs';

function indexKey(contactId: number): string {
  return `session:index:${contactId}`;
}

/** The public id of a stored session key: the same key always gives the same id, so two requests can never disagree. */
function sidFor(key: string): string {
  return createHash('sha256').update(`sid:${key}`).digest('base64url').slice(0, 16);
}

/** Copies what the request says into the record; true when something changed. */
function noteDevice(record: SessionRecord, device: SessionDevice | undefined, signIn = false): boolean {
  if (!device) return false;
  let changed = false;
  if (signIn && device.ip && record.ip !== device.ip) {
    record.ip = device.ip;
    changed = true;
  }
  if (device.ip && record.lastIp !== device.ip) {
    record.lastIp = device.ip;
    changed = true;
  }
  // A phone's session stays a phone's: a request of the same token without the app's header (a web view) is not a browser.
  if (record.platform !== device.platform && (record.platform === undefined || device.platform !== 'web')) {
    record.platform = device.platform;
    changed = true;
  }
  if (device.appVersion && record.appVersion !== device.appVersion) {
    record.appVersion = device.appVersion;
    changed = true;
  }
  return changed;
}

export type ListedSession = { key: string; record: SessionRecord & { sid: string } };

/** Tokens are stored hashed: a database leak does not leak usable sessions. */
export class SessionStore {
  constructor(
    private readonly kv: KV,
    private readonly sessionDays: number,
  ) {}

  private endedContacts: Promise<Set<number>> | null = null;
  private ended(): Promise<Set<number>> {
    this.endedContacts ??= this.kv.get<number[]>(ENDED_CONTACTS_KEY).then(
      (ids) => new Set(ids ?? []),
      (error: unknown) => {
        this.endedContacts = null;
        throw error;
      },
    );
    return this.endedContacts;
  }

  /** M216: every session of this contact stops working now, on every device. */
  async endAll(contactId: number): Promise<void> {
    const ids = await this.ended();
    ids.add(contactId);
    await this.kv.set(ENDED_CONTACTS_KEY, [...ids]);
  }

  /** M264: index edits of one contact run one after the other, so two sign-ins at once never lose a line. */
  private readonly indexQueue = new Map<number, Promise<void>>();
  private editIndex(contactId: number, edit: (entries: IndexEntry[]) => IndexEntry[] | Promise<IndexEntry[]>): Promise<void> {
    const run = (this.indexQueue.get(contactId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const key = indexKey(contactId);
        const before = (await this.kv.get<IndexEntry[]>(key)) ?? [];
        const after = await edit(before);
        if (after === before) return;
        if (after.length) await this.kv.set(key, after);
        else await this.kv.delete(key);
      });
    this.indexQueue.set(contactId, run);
    const release = () => {
      if (this.indexQueue.get(contactId) === run) this.indexQueue.delete(contactId);
    };
    run.then(release, release);
    return run;
  }

  /** A record that is this contact's, still valid, and the one the index line names. */
  private async liveRecord(contactId: number, entry: IndexEntry): Promise<(SessionRecord & { sid: string }) | null> {
    const record = await this.kv.get<SessionRecord>(entry.key);
    if (!record || record.contactId !== contactId || Date.parse(record.expiresAt) <= Date.now()) return null;
    return { ...record, sid: entry.sid };
  }

  private addToIndex(contactId: number, entry: IndexEntry): Promise<void> {
    return this.editIndex(contactId, async (entries) => {
      if (entries.some((item) => item.sid === entry.sid)) return entries;
      // A long list is mostly sessions that ended by themselves (expired, signed out elsewhere): drop those lines here.
      const kept = entries.length >= INDEX_PRUNE_AT ? await this.liveEntries(contactId, entries) : entries;
      return [...kept, entry];
    });
  }

  private async liveEntries(contactId: number, entries: IndexEntry[]): Promise<IndexEntry[]> {
    const live: IndexEntry[] = [];
    for (const entry of entries) if (await this.liveRecord(contactId, entry)) live.push(entry);
    return live;
  }

  async createSession(uuid: string, contactId: number, adminVerified = false, totpVerified = false, remember = false, device?: SessionDevice): Promise<string> {
    const token = newToken();
    const key = keyFor('session', token);
    const now = new Date();
    const record: SessionRecord = {
      uuid,
      contactId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.sessionDays * 86_400_000).toISOString(),
      lastSeenAt: now.toISOString(),
      sid: sidFor(key),
      ...(adminVerified ? { adminVerifiedAt: now.toISOString() } : {}),
      ...(adminVerified && remember ? { adminRemember: true } : {}),
      ...(totpVerified ? { totpVerifiedAt: now.toISOString() } : {}),
    };
    noteDevice(record, device, true);
    await this.kv.set(key, record);
    await this.addToIndex(contactId, { sid: sidFor(key), key });
    return token;
  }

  /**
   * `device` is what the request itself says (M264): a new address, platform or app version is kept at once, the
   * last-seen time once an hour as before. A session stored before M264 gets its public id and its line in the
   * member's list here, on its first request.
   */
  async getSession(token: string, device?: SessionDevice): Promise<SessionRecord | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const key = keyFor('session', token);
    const record = await this.kv.get<SessionRecord>(key);
    if (!record) return null;
    if (Date.parse(record.expiresAt) <= Date.now() || (await this.ended()).has(record.contactId)) {
      await this.kv.delete(key);
      return null;
    }
    const cutoff = (await this.cutoffMap()).get(record.contactId);
    if (cutoff && sidFor(key) !== cutoff.keep && Date.parse(record.createdAt) < Date.parse(cutoff.before)) {
      await this.kv.delete(key);
      return null;
    }
    const adopted = !record.sid;
    if (adopted) record.sid = sidFor(key);
    const touched = Date.now() - Date.parse(record.lastSeenAt) > TOUCH_INTERVAL_MS;
    if (touched) record.lastSeenAt = new Date().toISOString();
    const moved = noteDevice(record, device);
    if (adopted || touched || moved) await this.kv.set(key, record);
    // The hourly look also repairs a line the index lost (it is one small document, written by several requests).
    if (adopted || touched) await this.addToIndex(record.contactId, { sid: sidFor(key), key });
    return record;
  }

  /** M264: the sign-in itself — the address it came from, and the device as that request names it. */
  async noteSignIn(token: string, device: SessionDevice): Promise<void> {
    if (!TOKEN_PATTERN.test(token)) return;
    const key = keyFor('session', token);
    const record = await this.kv.get<SessionRecord>(key);
    if (record && noteDevice(record, device, true)) await this.kv.set(key, record);
  }

  async deleteSession(token: string): Promise<void> {
    if (!TOKEN_PATTERN.test(token)) return;
    const key = keyFor('session', token);
    const record = await this.kv.get<SessionRecord>(key);
    await this.kv.delete(key);
    if (record) await this.editIndex(record.contactId, (entries) => (entries.some((item) => item.key === key) ? entries.filter((item) => item.key !== key) : entries));
  }

  /** M264: every live session of this contact, the latest active first. Lines of sessions that are gone leave the index. */
  async listSessions(contactId: number): Promise<ListedSession[]> {
    if ((await this.ended()).has(contactId)) return [];
    const entries = (await this.kv.get<IndexEntry[]>(indexKey(contactId))) ?? [];
    const listed: ListedSession[] = [];
    for (const entry of entries) {
      const record = await this.liveRecord(contactId, entry);
      if (record) listed.push({ key: entry.key, record });
    }
    if (listed.length !== entries.length) {
      const live = new Set(listed.map((item) => item.record.sid));
      await this.editIndex(contactId, (now) => now.filter((item) => live.has(item.sid) || !entries.some((old) => old.sid === item.sid)));
    }
    return listed.sort((a, b) => Date.parse(b.record.lastSeenAt) - Date.parse(a.record.lastSeenAt));
  }

  /**
   * M264: ends the sessions of this contact that `pick` chooses (by public id) and returns their records. Only lines
   * of the contact's own index are ever looked at, so an id of another account ends nothing.
   */
  async endSessions(contactId: number, pick: (sid: string) => boolean): Promise<SessionRecord[]> {
    const ended: SessionRecord[] = [];
    await this.editIndex(contactId, async (entries) => {
      const chosen = entries.filter((entry) => pick(entry.sid));
      if (!chosen.length) return entries;
      for (const entry of chosen) {
        const record = await this.kv.get<SessionRecord>(entry.key);
        if (record && record.contactId !== contactId) continue;
        await this.kv.delete(entry.key);
        if (record) ended.push(record);
      }
      return entries.filter((entry) => !pick(entry.sid));
    });
    return ended;
  }

  private cutoffs: Promise<Map<number, Cutoff>> | null = null;
  private cutoffMap(): Promise<Map<number, Cutoff>> {
    this.cutoffs ??= this.kv.get<Record<string, Cutoff>>(CUTOFFS_KEY).then(
      (stored) => new Map(Object.entries(stored ?? {}).map(([id, cutoff]) => [Number(id), cutoff])),
      (error: unknown) => {
        this.cutoffs = null;
        throw error;
      },
    );
    return this.cutoffs;
  }

  /**
   * M264 «تسجيل الخروج من كل الأجهزة الأخرى»: every session of the contact but `keepSid` ends. The listed ones are
   * deleted now; a session stored before M264 that has not made a request since (so it has no line in the list yet)
   * is refused by the cutoff the moment it comes back — nothing older than this press survives it.
   */
  async endOthers(contactId: number, keepSid: string): Promise<SessionRecord[]> {
    const ended = await this.endSessions(contactId, (sid) => sid !== keepSid);
    const cutoffs = await this.cutoffMap();
    const now = Date.now();
    // A cutoff older than a session's whole life has nothing left to refuse.
    for (const [id, cutoff] of cutoffs) if (now - Date.parse(cutoff.before) > this.sessionDays * 86_400_000) cutoffs.delete(id);
    cutoffs.set(contactId, { before: new Date(now).toISOString(), keep: keepSid });
    await this.kv.set(CUTOFFS_KEY, Object.fromEntries(cutoffs));
    return ended;
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
