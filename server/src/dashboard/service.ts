import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { RequestError } from '../auth/guard.js';
import type { AuthService, Me } from '../auth/service.js';
import type { SessionRecord } from '../auth/sessions.js';
import { HubError, hubCall, type HubAccount, type HubBody, type HubClient, type HubResults } from '../hub/types.js';
import type { MembershipService } from '../membership/service.js';
import type { PaymentStats, PaymentsService } from '../payments/service.js';
import type { PbBalance, PbBalanceLite, PbBridge, PbMember } from '../projectsBank/bridge.js';
import type { PushService } from '../push/service.js';
import { parseHubTime, riyadhDay } from '../riyadh.js';
import type { KV } from '../store.js';

/**
 * The dashboard's view of the club (docs/BRIDGE_V2.md 4): the hub stays the one source of accounts and memberships
 * (rule 2), this service only relays its `admin_*` ops with a short cache, adds the Projects Bank «رصيد» beside the
 * members and records every write in the audit log. A hub older than 2.7.0 or a missing PB bridge never fails a whole
 * page: the section says so and the rest still answers.
 */
export const AUDIT_KEY = 'admin:audit';
const AUDIT_KEEP = 1000;
const ANSWERS_KEEP = 500;
const CACHE_MS = 45_000;
const BRIDGE_OK_MS = 5 * 60_000;
const BRIDGE_RETRY_MS = 60_000;
const HUB_V2 = [2, 7, 0];
const PB_V2 = [39, 0];
const UPGRADE_HUB = 'حدّث إضافة الهب إلى 2.7.0';

export type SectionError = { code: string; message: string };
export type BridgeInfo = { hub: { version: string | null; ok: boolean }; pb: { version: string | null; ok: boolean } };
export type PbBeside = Pick<PbBalanceLite, 'left' | 'used' | 'granted'>;

export type AuditEntry = {
  id: string;
  at: string;
  actor: { id: number; name: string; email: string };
  action: 'grant' | 'role' | 'pb_grant' | 'reply';
  contactId: number;
  params: Record<string, unknown>;
  note: string;
  result: 'ok' | 'error';
  error: string | null;
  requestId: string | null;
  /** What the write answered, replayed when the same requestId arrives again. */
  answer: Record<string, unknown> | null;
};

export type AdminActor = { session: SessionRecord; me: Me };

function sectionError(error: unknown): SectionError {
  if (error instanceof HubError || error instanceof RequestError) return { code: error.code, message: error.message };
  return { code: 'internal', message: 'تعذّر تحميل هذا القسم الآن' };
}

function atLeast(version: string | null, wanted: number[]): boolean {
  if (!version) return false;
  const parts = version.split(/[^0-9]+/).filter(Boolean).map(Number);
  for (const [index, need] of wanted.entries()) {
    const have = parts[index] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

export function toPbMember(account: Pick<HubAccount, 'id' | 'member_end' | 'member_days' | 'name' | 'email' | 'phone'>): PbMember {
  return { contact_id: account.id, member_end: account.member_end, member_days: account.member_days, name: account.name, email: account.email, phone: account.phone };
}

/** Answers kept for a short while under a key that does not depend on which admin asked. */
class ShortCache {
  private readonly map = new Map<string, { at: number; value: Promise<unknown> }>();

  get<T>(key: string, load: () => Promise<T>, ttl = CACHE_MS): Promise<T> {
    const cached = this.map.get(key);
    if (cached && Date.now() - cached.at < ttl) return cached.value as Promise<T>;
    const value = load();
    this.map.set(key, { at: Date.now(), value });
    // A failure is never served twice.
    value.catch(() => this.map.get(key)?.value === value && this.map.delete(key));
    if (this.map.size > 500) this.map.clear();
    return value;
  }

  bust(...prefixes: string[]): void {
    for (const key of this.map.keys()) {
      if (!prefixes.length || prefixes.some((prefix) => key.startsWith(prefix))) this.map.delete(key);
    }
  }
}

type Deps = { hub: HubClient; pb: PbBridge; kv: KV; auth: AuthService; payments: PaymentsService; membership: MembershipService; push: PushService; log: FastifyBaseLogger };

export class DashboardService {
  private readonly cache = new ShortCache();
  private bridgeInfo: { value: BridgeInfo; at: number } | null = null;
  private auditChain: Promise<unknown> = Promise.resolve();
  /** Writes in flight and the answers of the finished ones, by action, account and requestId (single-instance server). */
  private readonly running = new Map<string, Promise<Record<string, unknown>>>();
  private readonly answered = new Map<string, Record<string, unknown>>();

  constructor(private readonly deps: Deps) {}

  /** Webhooks and writes drop what they made stale: `hub`, `threads`, `pb` or everything. */
  bust(...groups: ('hub' | 'threads' | 'pb')[]): void {
    if (!groups.length) return this.cache.bust();
    if (groups.includes('hub')) this.cache.bust('hub:admin_stats', 'hub:admin_accounts', 'hub:admin_member', 'hub:admin_payments', 'hub:admin_tickets', 'hub:admin_leads', 'hub:admin_mail');
    if (groups.includes('threads')) this.cache.bust('hub:admin_threads', 'hub:admin_thread');
    if (groups.includes('pb')) this.cache.bust('pb:');
  }

  /** One hub op for the dashboard. The admin's uuid goes with every call but is not part of the cache key. */
  private async hub<K extends keyof HubResults>(admin: AdminActor, op: K, body: HubBody, cached = true): Promise<HubResults[K]> {
    const load = async (): Promise<HubResults[K]> => {
      try {
        return await hubCall(this.deps.hub, op, { ...body, uuid: admin.session.uuid });
      } catch (error) {
        if (error instanceof HubError && error.code === 'hub_not_supported') throw new HubError('hub_not_supported', UPGRADE_HUB, 501);
        throw error;
      }
    };
    return cached ? this.cache.get(`hub:${op}:${JSON.stringify(body)}`, load) : load();
  }

  /** Versions of both bridges, for /health and the dashboard's home. Checked at most every few minutes, never throws. */
  async bridge(): Promise<BridgeInfo> {
    const known = this.bridgeInfo;
    if (known && Date.now() - known.at < (known.value.hub.ok && known.value.pb.ok ? BRIDGE_OK_MS : BRIDGE_RETRY_MS)) return known.value;
    const hubVersion = async (): Promise<string | null> => {
      try {
        const ping = await hubCall(this.deps.hub, 'ping', {});
        if (typeof ping.version === 'string' && ping.version) return ping.version;
        // Plugins before 2.7.0 report their version in the widget config only.
        const config = (await this.deps.hub.call('config', {})).config ?? {};
        return typeof config.version === 'string' && config.version ? config.version : null;
      } catch {
        return null;
      }
    };
    const pbVersion = async (): Promise<string | null> => {
      try {
        return (await this.deps.pb.ping()).version || null;
      } catch {
        return null;
      }
    };
    const [hub, pb] = await Promise.all([hubVersion(), pbVersion()]);
    const value: BridgeInfo = { hub: { version: hub, ok: atLeast(hub, HUB_V2) }, pb: { version: pb, ok: atLeast(pb, PB_V2) } };
    this.bridgeInfo = { value, at: Date.now() };
    return value;
  }

  /** For /health, which must answer at once: the last check (nulls before the first), refreshed in the background. */
  bridgeKnown(): BridgeInfo & { checkedAt: string | null } {
    const known = this.bridgeInfo;
    void this.bridge().catch(() => undefined);
    return known ? { ...known.value, checkedAt: new Date(known.at).toISOString() } : { hub: { version: null, ok: false }, pb: { version: null, ok: false }, checkedAt: null };
  }

  async home(admin: AdminActor, days: number, now = Date.now()): Promise<{
    hub: HubResults['admin_stats'] | null;
    app: { payments: PaymentStats; store: { series: { day: string; purchases: number; renewals: number }[] }; push: { devices: number } };
    pb: { unlocksToday: number | null };
    bridge: BridgeInfo;
    errors: { hub?: SectionError; pb?: SectionError };
  }> {
    const errors: { hub?: SectionError; pb?: SectionError } = {};
    const [hub, payments, store, push, unlocksToday, bridge] = await Promise.all([
      this.hub(admin, 'admin_stats', { days }).catch((error: unknown) => {
        errors.hub = sectionError(error);
        return null;
      }),
      this.deps.payments.dailyStats(days, now),
      this.deps.membership.dailyStats(days, now),
      this.deps.push.summary(),
      this.cache
        .get('pb:unlocksToday', async () => {
          const today = riyadhDay(now);
          const { items } = await this.deps.pb.unlocks({ page: 1, perPage: 100 });
          return items.filter((row) => riyadhDay(parseHubTime(row.unlocked_at)) === today).length;
        })
        .catch((error: unknown) => {
          errors.pb = sectionError(error);
          return null;
        }),
      this.bridge(),
    ]);
    return { hub, app: { payments, store, push: { devices: push.total } }, pb: { unlocksToday }, bridge, errors };
  }

  /** The hub's list with the Projects Bank «رصيد» beside every active member, through one `balances` call. */
  async accounts(admin: AdminActor, query: { q: string; state: string; page: number; perPage: number }): Promise<Omit<HubResults['admin_accounts'], 'items'> & { items: (HubAccount & { pb: PbBeside | null })[]; pbError: SectionError | null }> {
    const result = await this.hub(admin, 'admin_accounts', { q: query.q, state: query.state, page: query.page, per_page: query.perPage });
    const members = result.items.filter((account) => account.state === 'member');
    let balances: Record<string, PbBalanceLite> = {};
    let pbError: SectionError | null = null;
    if (members.length) {
      try {
        balances = await this.cache.get(`pb:balances:${members.map((account) => `${account.id}:${account.member_end}`).join(',')}`, () => this.deps.pb.balances(members.map(toPbMember)));
      } catch (error) {
        pbError = sectionError(error);
      }
    }
    const beside = (account: HubAccount): PbBeside | null => {
      const balance = balances[String(account.id)];
      return balance ? { left: balance.left, used: balance.used, granted: balance.granted } : null;
    };
    return { ...result, items: result.items.map((account) => ({ ...account, pb: beside(account) })), pbError };
  }

  async account(admin: AdminActor, contactId: number): Promise<HubResults['admin_member'] & { pb: PbBalance | null; pbError: SectionError | null }> {
    const result = await this.hub(admin, 'admin_member', { contact_id: contactId });
    let pb: PbBalance | null = null;
    let pbError: SectionError | null = null;
    // A lapsed member keeps his old unlocks in PB, so the balance is asked for anyone who ever was a member.
    if (result.account.state === 'member' || result.account.state === 'expired') {
      try {
        pb = await this.cache.get(`pb:balance:${contactId}:${result.account.member_end}`, () => this.deps.pb.balance(toPbMember(result.account)));
      } catch (error) {
        pbError = sectionError(error);
      }
    }
    return { ...result, pb, pbError };
  }

  /**
   * M33: Projects Bank unlocks bucketed by Riyadh day over the last `days` — read from the bridge's newest
   * rows (up to 500), so the analytics counter (which only starts counting now) still gets a full history.
   */
  pbUnlockDays(days: number, now = Date.now()): Promise<Record<string, number>> {
    return this.cache.get(`pb:unlockDays:${days}`, async () => {
      const since = riyadhDay(now - (days - 1) * 86_400_000);
      const buckets: Record<string, number> = {};
      for (let page = 1; page <= 5; page += 1) {
        const { total, items } = await this.deps.pb.unlocks({ page, perPage: 100 });
        let past = false;
        for (const row of items) {
          const day = riyadhDay(parseHubTime(row.unlocked_at));
          if (day < since) {
            past = true;
            continue;
          }
          buckets[day] = (buckets[day] ?? 0) + 1;
        }
        if (past || page * 100 >= total || items.length === 0) break;
      }
      return buckets;
    });
  }

  /** M33: the active members by category, counted from the hub's own list (rule 2; pages of 100, capped at 1000). */
  async personas(admin: AdminActor): Promise<{ neutral: number; entrepreneur: number; investor: number; none: number; total: number }> {
    const counts = { neutral: 0, entrepreneur: 0, investor: 0, none: 0, total: 0 };
    for (let page = 1; page <= 10; page += 1) {
      const result = await this.hub(admin, 'admin_accounts', { q: '', state: 'member', page, per_page: 100 });
      for (const account of result.items) {
        counts.total += 1;
        if (account.persona === 'neutral' || account.persona === 'entrepreneur' || account.persona === 'investor') counts[account.persona] += 1;
        else counts.none += 1;
      }
      if (page * 100 >= result.total) break;
    }
    return counts;
  }

  hubPayments(admin: AdminActor, query: { q: string; status: string; action: string; page: number; perPage: number }): Promise<HubResults['admin_payments']> {
    return this.hub(admin, 'admin_payments', { q: query.q, status: query.status, action: query.action, page: query.page, per_page: query.perPage });
  }

  tickets(admin: AdminActor, query: { q: string; page: number; perPage: number }): Promise<HubResults['admin_tickets']> {
    return this.hub(admin, 'admin_tickets', { q: query.q, page: query.page, per_page: query.perPage });
  }

  leads(admin: AdminActor, query: { q: string; ltype: string; page: number; perPage: number }): Promise<HubResults['admin_leads']> {
    return this.hub(admin, 'admin_leads', { q: query.q, ltype: query.ltype, page: query.page, per_page: query.perPage });
  }

  /** Conversations move fast: a few seconds of cache only, and the webhook drops it on every new message. */
  threads(admin: AdminActor, query: { q: string; filter: string; page: number; perPage: number }): Promise<HubResults['admin_threads']> {
    const body = { q: query.q, filter: query.filter, page: query.page, per_page: query.perPage };
    return this.cache.get(`hub:admin_threads:${JSON.stringify(body)}`, () => this.hub(admin, 'admin_threads', body, false), 5_000);
  }

  /** Never cached: opening a thread also marks it read on the hub. */
  thread(admin: AdminActor, contactId: number, before: number | null): Promise<HubResults['admin_thread']> {
    return this.hub(admin, 'admin_thread', { contact_id: contactId, ...(before ? { before } : {}) }, false);
  }

  mail(admin: AdminActor): Promise<HubResults['admin_mail']> {
    return this.hub(admin, 'admin_mail', {});
  }

  async audit(limit: number): Promise<AuditEntry[]> {
    return ((await this.deps.kv.get<{ entries: AuditEntry[] }>(AUDIT_KEY))?.entries ?? []).slice(0, limit);
  }

  private record(entry: AuditEntry): Promise<void> {
    const run = this.auditChain.then(async () => {
      const entries = (await this.deps.kv.get<{ entries: AuditEntry[] }>(AUDIT_KEY))?.entries ?? [];
      await this.deps.kv.set(AUDIT_KEY, { entries: [entry, ...entries].slice(0, AUDIT_KEEP) });
    });
    this.auditChain = run.catch(() => undefined);
    return run;
  }

  /**
   * Every dashboard write goes through here: who, when, what, the note and the result land in `admin:audit`, failures
   * included. A repeated `requestId` (a double tap, a retry after a lost answer) replays the first answer and changes
   * nothing: a twin that arrives while the first is still running waits for it instead of writing beside it.
   */
  private write<T extends Record<string, unknown>>(admin: AdminActor, action: AuditEntry['action'], contactId: number, input: { params: Record<string, unknown>; note: string; requestId: string | null }, run: () => Promise<T>): Promise<T & { already: boolean }> {
    const key = input.requestId ? `${action}:${contactId}:${input.requestId}` : null;
    if (!key) return this.perform(admin, action, contactId, input, null, run);
    const running = this.running.get(key);
    if (running) return running.then((first) => ({ ...(first as T), already: true }));
    // Registered before the first await: no second request can slip between the lookup and the write.
    const job = this.perform(admin, action, contactId, input, key, run);
    this.running.set(key, job);
    const done = (): void => {
      if (this.running.get(key) === job) this.running.delete(key);
    };
    job.then(done, done);
    return job;
  }

  private async perform<T extends Record<string, unknown>>(admin: AdminActor, action: AuditEntry['action'], contactId: number, input: { params: Record<string, unknown>; note: string; requestId: string | null }, key: string | null, run: () => Promise<T>): Promise<T & { already: boolean }> {
    if (key) {
      const replay = this.answered.get(key) ?? (await this.audit(AUDIT_KEEP)).find((entry) => entry.requestId === input.requestId && entry.action === action && entry.contactId === contactId && entry.result === 'ok')?.answer;
      if (replay) return { ...(replay as T), already: true };
    }
    const base = { id: randomUUID(), at: new Date().toISOString(), actor: { id: admin.me.id, name: admin.me.name, email: admin.me.email }, action, contactId, params: input.params, note: input.note, requestId: input.requestId };
    let answer: T;
    try {
      answer = await run();
    } catch (error) {
      const code = error instanceof HubError || error instanceof RequestError ? error.code : 'internal';
      this.deps.log.warn({ action, contactId, code }, 'dashboard write failed');
      // The admin sees why the write failed, not that the log could not be saved.
      await this.record({ ...base, result: 'error', error: code, answer: null }).catch((failure: unknown) => this.deps.log.error({ err: failure, action, contactId }, 'audit entry not saved'));
      throw error;
    }
    // From here on the change is real whatever happens to the log: the answer is kept in memory first, so a retry
    // replays it even while kv is down, and a log that cannot be saved never turns a done write into an error.
    if (key) {
      this.answered.set(key, answer);
      if (this.answered.size > ANSWERS_KEEP) this.answered.delete(this.answered.keys().next().value as string);
    }
    const entry: AuditEntry = { ...base, result: 'ok', error: null, answer };
    await this.record(entry)
      .catch(() => this.record(entry))
      // Ids only: the excerpt of a reply and the admin's e-mail stay out of the logs.
      .catch((failure: unknown) => this.deps.log.error({ err: failure, audit: { id: entry.id, at: entry.at, actor: entry.actor.id, action, contactId, requestId: entry.requestId, params: action === 'reply' ? {} : entry.params } }, 'audit entry not saved for a write that WAS applied: this line is its only record'));
    return { ...answer, already: false };
  }

  grant(admin: AdminActor, contactId: number, input: { action: 'activate' | 'extend' | 'revoke'; days: number | null; note: string; requestId: string | null }) {
    return this.write(admin, 'grant', contactId, { params: { action: input.action, days: input.days }, note: input.note, requestId: input.requestId }, async () => {
      const result = await this.hub(admin, 'admin_grant', { contact_id: contactId, action: input.action, days: input.days ?? 0, note: input.note }, false);
      // The member's next request in the app reads the new state from the hub.
      this.deps.auth.forget(contactId);
      this.bust('hub', 'pb');
      return { ok: true as const, contact: result.contact, event: result.event };
    });
  }

  setRole(admin: AdminActor, contactId: number, input: { role: 'member' | 'publisher'; note: string; requestId: string | null }) {
    return this.write(admin, 'role', contactId, { params: { role: input.role }, note: input.note, requestId: input.requestId }, async () => {
      const result = await this.hub(admin, 'admin_set_role', { contact_id: contactId, role: input.role }, false);
      this.deps.auth.forget(contactId);
      this.bust('hub');
      return { ok: true as const, contact: result.contact };
    });
  }

  pbGrant(admin: AdminActor, contactId: number, input: { amount: number; note: string; requestId: string | null }) {
    return this.write(admin, 'pb_grant', contactId, { params: { amount: input.amount }, note: input.note, requestId: input.requestId }, async () => {
      // PB files a grant under the member's current year, which only the hub knows.
      const { account } = await this.hub(admin, 'admin_member', { contact_id: contactId });
      if (account.state !== 'member') throw new RequestError('not_member', 'رصيد بنك المشاريع يُضاف للأعضاء المشتركين فقط', 409);
      const result = await this.deps.pb.grant({ contactId, amount: input.amount, note: input.note, actor: admin.me.name || admin.me.email, member: toPbMember(account) });
      this.bust('pb');
      return { ok: true as const, granted: result.granted, left: result.left };
    });
  }

  reply(admin: AdminActor, contactId: number, text: string, requestId: string | null) {
    return this.write(admin, 'reply', contactId, { params: { length: text.length, excerpt: text.slice(0, 80) }, note: '', requestId }, async () => {
      const result = await this.hub(admin, 'admin_reply', { contact_id: contactId, text }, false);
      this.bust('threads');
      return { ok: true as const, message_id: result.message_id };
    });
  }
}
