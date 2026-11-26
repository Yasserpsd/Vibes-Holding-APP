import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { AccountDeletionStore } from '../auth/deletion.js';
import { RequestError } from '../auth/guard.js';
import { BACKUP_ADMIN_UUID_KEY } from '../backup/service.js';
import type { AuthService, Me, Persona } from '../auth/service.js';
import type { SessionRecord } from '../auth/sessions.js';
import { countByCountry, type CountriesAnswer } from './countries.js';
import { HubError, hubCall, type HubAccount, type HubBody, type HubClient, type HubResults } from '../hub/types.js';
import type { Notifier } from '../mail/notify.js';
import { HUB_HONORARY_VERSION, isHonorary, pbPeriodOf } from '../membership/honorary.js';
import { HUB_PARTNER_VERSION, isPartner } from '../membership/partner.js';
import { PartnerProjectStore, projectLabel, type PartnerLink, type PartnerProject } from '../membership/partnerProjects.js';
import type { ProjectsService } from '../projectsBank/service.js';
import type { MembershipService } from '../membership/service.js';
import type { PaymentStats, PaymentsService } from '../payments/service.js';
import type { PbBalance, PbBalanceLite, PbBridge, PbMember } from '../projectsBank/bridge.js';
import type { PushService } from '../push/service.js';
import { parseHubTime, riyadhDay } from '../riyadh.js';
import type { KV } from '../store.js';
import type { WhatsappService } from '../whatsapp/service.js';
import { tellMember } from '../whatsapp/tell.js';

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
const HUB_DELETE_VERSION = [2, 30, 0];
const UPGRADE_HUB_DELETE = 'حذف الحساب يحتاج تحديث إضافة الهب إلى 2.30.0 أو أحدث';
const UPGRADE_HUB_HONORARY = 'العضوية الشرفية تحتاج تحديث إضافة الهب إلى 2.28.0 أو أحدث';
// M215: the same two sentences prefill the note in admin/src/sections/MemberSheet.tsx.
const HONORARY_NOTE_GRANT = 'منح العضوية الشرفية: شريك رسمي في عقد تأسيس إحدى شركات Vibes Ventures';
const HONORARY_NOTE_REVOKE = 'سحب العضوية الشرفية';
const UPGRADE_HUB_PARTNER = 'عضوية شركاء النجاح تحتاج تحديث إضافة الهب إلى 2.33.0 أو أحدث';
// M271: the same two sentences prefill the note in admin/src/sections/MemberSheet.tsx.
const PARTNER_NOTE_GRANT = 'منح عضوية شركاء النجاح لمدة 360 يومًا';
const PARTNER_NOTE_REVOKE = 'سحب عضوية شركاء النجاح';
// M275: what the link itself writes and refuses with.
const PARTNER_NOTE_PROJECT = 'ربط شريك النجاح بمشروع';
export const PICK_PROJECT = 'اختر المشروع المرتبط بشريك النجاح أولًا: لا تُمنح العضوية بدون مشروع';

/** A project as the dashboard shows it: `url` is its public page in the Projects Bank, to open and read it. */
export type ShownProject = PartnerProject & { url: string | null };
export type SuccessPartnerRow = { contactId: number; name: string; phone: string; since: string; end: string; left: number | null; project: ShownProject | null };
export type PartnerProjectChoice = ShownProject & { holder: { contactId: number; name: string } | null };

export type SectionError = { code: string; message: string };
export type BridgeInfo = { hub: { version: string | null; ok: boolean }; pb: { version: string | null; ok: boolean } };
export type PbBeside = Pick<PbBalanceLite, 'left' | 'used' | 'granted'>;

export type AuditEntry = {
  id: string;
  at: string;
  actor: { id: number; name: string; email: string };
  action: 'grant' | 'role' | 'pb_grant' | 'reply' | 'honorary' | 'partner' | 'partner_project' | 'delete' | 'persona';
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

/**
 * The two narrowing filters of the members list, applied by the server because the hub has neither:
 * the category (`partners` = M275, a running Success Partners membership; pending and lead rows are not «accounts» yet, the same rule as the home card) and the memberships ending within 7 / 30 days (dated paid ones, like the hub's expiring count).
 */
const CATEGORIES = ['neutral', 'entrepreneur', 'investor'];

/**
 * M281 (owner, 2026-11-26: «ألغي تماما بدون فئة دول وحولهم كلهم محايدين… وألغي تماما بدون فئة دي من كل محل»): an account
 * the hub still holds without a category is «محايد» on every dashboard screen (hub 2.35.0 writes the same into its rows).
 */
export function withCategory<K extends keyof HubResults>(op: K, result: HubResults[K]): HubResults[K] {
  const fill = (account: HubAccount): HubAccount => (account.state === 'lead' || CATEGORIES.includes(account.persona) ? account : { ...account, persona: 'neutral' });
  if (op === 'admin_accounts') {
    const list = result as HubResults['admin_accounts'];
    return { ...list, items: list.items.map(fill) } as HubResults[K];
  }
  if (op === 'admin_member') {
    const one = result as HubResults['admin_member'];
    return { ...one, account: fill(one.account) } as HubResults[K];
  }
  if (op === 'admin_stats') {
    const stats = result as HubResults['admin_stats'];
    const totals = stats.totals;
    if (totals.persona_investor === undefined) return result;
    const rest = Math.max(0, totals.accounts - (totals.persona_neutral ?? 0) - (totals.persona_entrepreneur ?? 0) - totals.persona_investor);
    return { ...stats, totals: { ...totals, persona_neutral: (totals.persona_neutral ?? 0) + rest } } as HubResults[K];
  }
  return result;
}

/** M281: the members list has no «بانتظار تأكيد البريد» view any more — and «الكل» counts what the list shows. */
function withoutPending(counts: Record<string, number> | undefined): Record<string, number> {
  const rest = { ...(counts ?? {}) };
  if (typeof rest.all === 'number') rest.all = Math.max(0, rest.all - (rest.pending ?? 0));
  delete rest.pending;
  return rest;
}

export function accountMatches(account: HubAccount, persona = 'all', ends = 'all'): boolean {
  if (persona === 'partners') {
    if (!isPartner(account)) return false;
  } else if (persona !== 'all') {
    // A category belongs to a registered account: one still waiting for its e-mail (or a lead) is in no category row, as in no home card.
    if (account.state === 'pending' || account.state === 'lead') return false;
    if (account.persona !== persona) return false;
  }
  if (ends !== 'all') {
    const days = Number(ends);
    if (account.state !== 'member' || account.honorary === 1 || account.never_expires === 1 || account.member_left === null || account.member_left > days) return false;
  }
  return true;
}

export function toPbMember(account:Pick<HubAccount, 'id' | 'member_end' | 'member_days' | 'honorary' | 'honorary_since' | 'name' | 'email' | 'phone'>): PbMember {
  // M205: the honorary member's Projects Bank year (membership/honorary.ts).
  return { contact_id: account.id, ...pbPeriodOf(account), name: account.name, email: account.email, phone: account.phone };
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

type Deps = { hub: HubClient; pb: PbBridge; kv: KV; auth: AuthService; payments: PaymentsService; membership: MembershipService; push: PushService; log: FastifyBaseLogger; /** M205: the honorary membership notice goes on WhatsApp. */ whatsapp?: WhatsappService; /** M215: the management's mail for an honorary grant or revoke. */ notifier?: Notifier; /** M216: a dashboard deletion ends the member's own 30-day request. */ deletion?: AccountDeletionStore; /** M243: a deleted account leaves the messages' read lists. */ postOpens?: { forgetContact(contactId: number): Promise<void> }; /** M275: the bank a Success Partner is tied to. */ projects: Pick<ProjectsService, 'all' | 'get' | 'pageUrl'> };

export class DashboardService {
  private readonly cache = new ShortCache();
  private bridgeInfo: { value: BridgeInfo; at: number } | null = null;
  private auditChain: Promise<unknown> = Promise.resolve();
  /** Writes in flight and the answers of the finished ones, by action, account and requestId (single-instance server). */
  private readonly running = new Map<string, Promise<Record<string, unknown>>>();
  private readonly answered = new Map<string, Record<string, unknown>>();

  private readonly links: PartnerProjectStore;

  constructor(private readonly deps: Deps) {
    this.links = new PartnerProjectStore(deps.kv);
  }

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
        const result = await hubCall(this.deps.hub, op, { ...body, uuid: admin.session.uuid });
        // M130: the hub just honoured this uuid as an admin — remember it for the nightly members export.
        this.rememberAdmin(admin.session.uuid);
        return withCategory(op, result);
      } catch (error) {
        if (error instanceof HubError && error.code === 'hub_not_supported') throw new HubError('hub_not_supported', UPGRADE_HUB, 501);
        throw error;
      }
    };
    return cached ? this.cache.get(`hub:${op}:${JSON.stringify(body)}`, load) : load();
  }

  /** One kv write an hour at most; the backup's members export reads it (backup/service.ts). */
  private adminRememberedAt = 0;
  private rememberAdmin(uuid: string): void {
    if (!uuid || Date.now() - this.adminRememberedAt < 60 * 60_000) return;
    this.adminRememberedAt = Date.now();
    void this.deps.kv.set(BACKUP_ADMIN_UUID_KEY, { uuid, at: new Date().toISOString() }).catch(() => {
      this.adminRememberedAt = 0;
    });
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
  async accounts(
    admin: AdminActor,
    query: { q: string; state: string; page: number; perPage: number; persona?: string; ends?: string; wa?: string; sort?: 'activity' | 'newest' },
  ): Promise<Omit<HubResults['admin_accounts'], 'items'> & { items: (HubAccount & { pb: PbBeside | null })[]; pbError: SectionError | null }> {
    let result: HubResults['admin_accounts'];
    // `registered` is a view of the hub's `all` without the accounts still waiting for their e-mail code.
    const registered = query.state === 'registered';
    // M275: every partner is a member to the hub, so the search for them never walks the whole registry.
    const wholeList = registered || query.state === 'all';
    const hubState = wholeList ? (query.persona === 'partners' ? 'member' : 'all') : query.state;
    // M281 (owner, 2026-11-26: «ألغي كمان بإنتظار تأكيد البريد»): a sign-up still typing its code is no account in any view.
    const kept = (account: HubAccount) => account.state !== 'pending' && accountMatches(account, query.persona, query.ends);
    const narrowed = registered || (query.persona && query.persona !== 'all') || (query.ends && query.ends !== 'all');
    // M210 (hub 2.28.4): the WhatsApp filter is the hub's own; an older hub ignores the key and sends no wa counts.
    const wa = query.wa && query.wa !== 'all' ? { wa: query.wa } : {};
    if (query.sort === 'newest') {
      // M229: the hub orders by activity, so the sign-up order needs the whole list: sweep it (pages of 100, cached, up to 20,000), newest first.
      const all: HubAccount[] = [];
      let counts: Record<string, number> = {};
      for (let page = 1; page <= 200; page += 1) {
        const slice = await this.hub(admin, 'admin_accounts', { q: query.q, state: hubState, page, per_page: 100, ...wa });
        counts = slice.counts;
        all.push(...slice.items.filter(kept));
        if (!slice.items.length || page * 100 >= slice.total) break;
      }
      // M230: the hub pages by offset over a list it orders by activity, so an account that becomes active while the pages
      // are read pushes another one onto the next page too. One row per account, whatever the sweep saw.
      const unique = [...new Map(all.map((account) => [account.id, account])).values()];
      unique.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id - a.id);
      const start = (query.page - 1) * query.perPage;
      result = { ok: true, total: unique.length, page: query.page, per_page: query.perPage, items: unique.slice(start, start + query.perPage), counts };
    } else if (narrowed) {
      // M86 (owner): the hub list has no persona filter yet, so the server sweeps it (pages of 100,
      // capped at 1000 like `personas()`), keeps the chosen category (and the memberships ending soon) and pages the match locally.
      const matched: HubAccount[] = [];
      let counts: Record<string, number> = {};
      for (let page = 1; page <= 10; page += 1) {
        const slice = await this.hub(admin, 'admin_accounts', { q: query.q, state: hubState, page, per_page: 100, ...wa });
        counts = slice.counts;
        matched.push(...slice.items.filter(kept));
        if (page * 100 >= slice.total) break;
      }
      const start = (query.page - 1) * query.perPage;
      result = { ok: true, total: matched.length, page: query.page, per_page: query.perPage, items: matched.slice(start, start + query.perPage), counts };
    } else {
      const page = await this.hub(admin, 'admin_accounts', { q: query.q, state: query.state, page: query.page, per_page: query.perPage, ...wa });
      const items = page.items.filter((account) => account.state !== 'pending');
      // The hub's counts ignore the WhatsApp filter, so under it only the rows this page dropped come off the total.
      const dropped = page.items.length - items.length;
      result = { ...page, items, total: Math.max(0, page.total - (query.state === 'all' && !wa.wa ? (page.counts?.pending ?? 0) : dropped)) };
    }
    result = { ...result, counts: withoutPending(result.counts) };
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

  async account(admin: AdminActor, contactId: number): Promise<HubResults['admin_member'] & { pb: PbBalance | null; pbError: SectionError | null; deletionRequest: { requestedAt: string; dueAt: string; reason: string } | null; partnerProject: ShownProject | null }> {
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
    // M216: the member's own 30-day request shows on the sheet, where the deletion is executed.
    const scheduled = await this.deps.deletion?.scheduledOf(contactId);
    // M275: only a running Success Partners membership shows its project.
    const link = isPartner(result.account) ? await this.links.of(contactId) : null;
    return { ...result, pb, pbError, deletionRequest: scheduled ? { requestedAt: scheduled.requestedAt, dueAt: scheduled.dueAt, reason: scheduled.reason } : null, partnerProject: link ? this.currentProject(link.project) : null };
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

  /**
   * M204: the ids of every account the hub registered before `beforeUtc` (its own `created_at`, UTC `Y-m-d H:i:s`),
   * for the one-time «older accounts» snapshot. Read fresh, pages of 100, up to 20,000 accounts.
   */
  async accountIdsBefore(admin: AdminActor, beforeUtc: string): Promise<{ ids: number[]; total: number }> {
    const ids: number[] = [];
    let total = 0;
    for (let page = 1; page <= 200; page += 1) {
      const result = await this.hub(admin, 'admin_accounts', { q: '', state: 'all', page, per_page: 100 }, false);
      total = result.total;
      for (const account of result.items) if (account.created_at && account.created_at < beforeUtc) ids.push(account.id);
      if (!result.items.length || page * 100 >= result.total) break;
    }
    return { ids, total };
  }

  /** M33/M86: accounts by category, counted from the hub's own list (rule 2; pages of 100, capped at 1000). */
  async personas(admin: AdminActor, state: 'member' | 'all' = 'member'): Promise<{ neutral: number; entrepreneur: number; investor: number; total: number; partners: number }> {
    const counts = { neutral: 0, entrepreneur: 0, investor: 0, total: 0, partners: 0 };
    for (let page = 1; page <= 10; page += 1) {
      const result = await this.hub(admin, 'admin_accounts', { q: '', state, page, per_page: 100 });
      for (const account of result.items) {
        // M281: a sign-up still typing its code is no account (the list leaves it out too).
        if (account.state === 'pending') continue;
        counts.total += 1;
        // M275: beside his category, not instead of it.
        if (isPartner(account)) counts.partners += 1;
        // Same rule as the list's category filters (accountMatches): only registered accounts are counted in a category.
        if (account.state === 'lead') continue;
        if (account.persona === 'neutral' || account.persona === 'entrepreneur' || account.persona === 'investor') counts[account.persona] += 1;
      }
      if (page * 100 >= result.total) break;
    }
    return counts;
  }

  /** M284 «خريطة الأعضاء»: every registered account by the country of its phone (sweep like `newest`, counts only). */
  async countries(admin: AdminActor): Promise<CountriesAnswer> {
    const all: HubAccount[] = [];
    for (let page = 1; page <= 200; page += 1) {
      const slice = await this.hub(admin, 'admin_accounts', { q: '', state: 'all', page, per_page: 100 });
      all.push(...slice.items.filter((account) => account.state !== 'pending'));
      if (!slice.items.length || page * 100 >= slice.total) break;
    }
    // M230: an account that turns active while the pages are read can show twice; one row per account.
    return countByCountry([...new Map(all.map((account) => [account.id, account])).values()]);
  }

  hubPayments(admin: AdminActor, query:{ q: string; status: string; action: string; page: number; perPage: number }): Promise<HubResults['admin_payments']> {
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
      // M234 (owner: «كل العمليات توصل واتس اب»): a membership given or extended from the dashboard is told on WhatsApp
      // like a paid one («سارية حتى»). A revoke and an honorary member (no end date) are not.
      const { contact, event } = result;
      if (input.action !== 'revoke' && !isHonorary(contact) && contact.member_end) {
        const lang = await this.memberLang(contactId, contact.lang);
        this.deps.whatsapp?.announceMembership({ phone: contact.phone, lang, name: contact.name, expiresAt: `${contact.member_end}T00:00:00+03:00`, ref: `membership:${contactId}:grant:${event.id}` }, () => undefined);
      }
      return { ok: true as const, contact: result.contact, event: result.event };
    });
  }

  /** M234: the language the member's app runs in now (his last seen device), else the one he registered with. */
  private async memberLang(contactId: number, registered: string | null | undefined): Promise<string | null> {
    return (await this.deps.push.langOf(contactId).catch(() => null)) ?? registered ?? null;
  }

  /**
   * M205 «عضوية شرفية»: given and taken back here only — an admin session, `confirm: true`, one audit entry. The flag
   * itself is the hub's (`admin_grant` honorary / honorary_revoke, hub 2.28.0): it overrides the paid clock, so a store
   * subscription under it keeps counting and decides the state again after a revoke. The member hears of a grant and
   * of a revoke on WhatsApp (the same words by e-mail when WhatsApp cannot carry them) and in the app.
   */
  honorary(admin: AdminActor, contactId: number, input: { on: boolean; note: string; requestId: string | null }) {
    // M215: the note writes itself; an admin who types one keeps those words.
    const note = input.note.trim() || (input.on ? HONORARY_NOTE_GRANT : HONORARY_NOTE_REVOKE);
    return this.write(admin, 'honorary', contactId, { params: { on: input.on }, note, requestId: input.requestId }, async () => {
      let result: HubResults['admin_grant'];
      try {
        result = await this.hub(admin, 'admin_grant', { contact_id: contactId, action: input.on ? 'honorary' : 'honorary_revoke', days: 0, note }, false);
      } catch (error) {
        if (error instanceof HubError && error.code === 'invalid' && (await this.hubBefore(HUB_HONORARY_VERSION))) throw new HubError('hub_not_supported', UPGRADE_HUB_HONORARY, 501);
        throw error;
      }
      // A hub that answered without the flag did not understand the action: nothing changed and nobody is told.
      if (isHonorary(result.contact) !== input.on) throw new HubError('hub_not_supported', UPGRADE_HUB_HONORARY, 501);
      this.deps.auth.forget(contactId);
      this.bust('hub', 'pb');
      // The member is told both ways (owner, 2026-11-06): the grant, and the end with the reason it is tied to —
      // the honorary membership belongs only to official partners in the founding contract of a Vibes Ventures company.
      const { contact, event } = result;
      const email = String(contact.contact_email ?? '').trim() || contact.email;
      void this.deps.whatsapp?.sendHonorary({ phone: contact.phone, lang: await this.memberLang(contactId, contact.lang), name: contact.name, email, ref: `honorary:${contactId}:${event.id}` }, !input.on);
      // M232: his devices leave (or rejoin) every broadcast at once; the one push about the membership itself still goes.
      await this.deps.push.setHonorary(contactId, input.on).catch(() => undefined);
      this.deps.push.honoraryChanged(contactId, input.on);
      this.deps.notifier?.honoraryChanged({ on: input.on, name: contact.name, phone: contact.phone, email, contactId, by: admin.me.name || admin.me.email, note });
      return { ok: true as const, contact: result.contact, event: result.event };
    });
  }

  /**
   * M271 «عضوية شركاء النجاح»: given and taken back here only, like the honorary one — an admin session, `confirm: true`,
   * one audit entry. The hub holds it (`admin_grant` partner / partner_revoke, 2.33.0) and ends it by itself after 360
   * days; a paid period under it keeps counting. Nothing about it is sold (rule 3). A grant is told on WhatsApp with the
   * approved «سارية حتى» template (M234), by e-mail when WhatsApp cannot carry it; a revoke by e-mail; both by push.
   * M275: no grant without a project of the bank that no other partner holds; a revoke frees it.
   */
  async partner(admin: AdminActor, contactId: number, input: { on: boolean; projectId: number | null; note: string; requestId: string | null }) {
    const note = input.note.trim() || (input.on ? PARTNER_NOTE_GRANT : PARTNER_NOTE_REVOKE);
    // The audit line names the project taken, or the one a revoke frees.
    const named = input.on ? this.deps.projects.get(input.projectId ?? 0) : ((await this.links.of(contactId))?.project ?? null);
    const params = { on: input.on, ...(input.on ? { projectId: input.projectId } : {}), ...(named ? { project: projectLabel(named) } : {}) };
    return this.write(admin, 'partner', contactId, { params, note, requestId: input.requestId }, async () => {
      let project: PartnerProject | null = null;
      let result: HubResults['admin_grant'];
      if (input.on) {
        const chosen = this.bankProject(input.projectId);
        project = chosen;
        result = await this.links.exclusive(() => this.grantWithProject(admin, contactId, chosen, note));
      } else {
        result = await this.setPartner(admin, contactId, false, note);
        await this.freeProject(contactId);
      }
      this.deps.auth.forget(contactId);
      this.bust('hub', 'pb');
      const { contact, event } = result;
      const email = String(contact.contact_email ?? '').trim() || contact.email;
      const lang = await this.memberLang(contactId, contact.lang);
      const until = input.on ? (contact.partner_end ?? null) : null;
      const mail = () => this.deps.notifier?.tellPartner({ on: input.on, to: email, lang: lang === 'en' ? 'en' : 'ar', name: contact.name, until });
      if (input.on && until && this.deps.whatsapp) {
        this.deps.whatsapp.announceMembership({ phone: contact.phone, lang, name: contact.name, expiresAt: `${until}T00:00:00+03:00`, ref: `partner:${contactId}:${event.id}` }, mail);
      } else {
        mail();
      }
      this.deps.push.partnerChanged(contactId, input.on, until);
      this.deps.notifier?.partnerChanged({ on: input.on, name: contact.name, phone: contact.phone, email, contactId, by: admin.me.name || admin.me.email, note, project: project ? projectLabel(project) : null });
      return { ok: true as const, contact: result.contact, event: result.event };
    });
  }

  /** The hub's half of a grant or a revoke. */
  private async setPartner(admin: AdminActor, contactId: number, on: boolean, note: string): Promise<HubResults['admin_grant']> {
    let result: HubResults['admin_grant'];
    try {
      result = await this.hub(admin, 'admin_grant', { contact_id: contactId, action: on ? 'partner' : 'partner_revoke', days: 0, note }, false);
    } catch (error) {
      if (error instanceof HubError && error.code === 'invalid' && (await this.hubBefore(HUB_PARTNER_VERSION))) throw new HubError('hub_not_supported', UPGRADE_HUB_PARTNER, 501);
      throw error;
    }
    // A hub that answered without the flag did not understand the action: nothing changed and nobody is told.
    if (isPartner(result.contact) !== on) throw new HubError('hub_not_supported', UPGRADE_HUB_PARTNER, 501);
    return result;
  }

  /**
   * M275, inside `links.exclusive`: the project is taken before the hub is asked, so a membership never starts without
   * one, and it is given back when the hub refuses. A hub that applied the grant and lost its answer keeps the link.
   */
  private async grantWithProject(admin: AdminActor, contactId: number, project: PartnerProject, note: string): Promise<HubResults['admin_grant']> {
    const account = await this.accountNow(admin, contactId);
    if (account && isPartner(account)) throw new RequestError('partner', 'هذا الحساب يحمل عضوية شركاء النجاح من قبل: غيّر مشروعه من «تغيير المشروع»', 409);
    await this.assertFree(admin, project, contactId);
    const previous = await this.links.of(contactId);
    await this.links.put(this.newLink(admin, contactId, project));
    try {
      return await this.setPartner(admin, contactId, true, note);
    } catch (error) {
      // No answer to this question either: the link stays, and its next reader frees it if the membership never started.
      const now = await this.accountNow(admin, contactId).catch(() => undefined);
      if (now !== undefined && !(now && isPartner(now))) await (previous ? this.links.put(previous) : this.links.remove(contactId));
      throw error;
    }
  }

  /** M275: links a partner given before the rule, or moves him to another project. The membership is untouched. */
  setPartnerProject(admin: AdminActor, contactId: number, input: { projectId: number; note: string; requestId: string | null }) {
    const note = input.note.trim() || PARTNER_NOTE_PROJECT;
    const named = this.deps.projects.get(input.projectId);
    const params = { projectId: input.projectId, ...(named ? { project: projectLabel(named) } : {}) };
    return this.write(admin, 'partner_project', contactId, { params, note, requestId: input.requestId }, async () => {
      const project = this.bankProject(input.projectId);
      await this.links.exclusive(async () => {
        const account = await this.accountNow(admin, contactId);
        if (!account || !isPartner(account)) throw new RequestError('not_partner', 'هذا الحساب لا يحمل عضوية شركاء النجاح، فلا يرتبط بمشروع', 409);
        await this.assertFree(admin, project, contactId);
        await this.links.put(this.newLink(admin, contactId, project));
      });
      return { ok: true as const, project };
    });
  }

  /** M275: the running Success Partners with their projects, and the bank as the picker offers it (name and number only). */
  async successPartners(admin: AdminActor): Promise<{ partners: SuccessPartnerRow[]; projects: PartnerProjectChoice[] }> {
    const found = new Map<number, HubAccount>();
    for (let page = 1; page <= 200; page += 1) {
      const slice = await this.hub(admin, 'admin_accounts', { q: '', state: 'member', page, per_page: 100 });
      for (const account of slice.items) if (isPartner(account)) found.set(account.id, account);
      if (!slice.items.length || page * 100 >= slice.total) break;
    }
    // A year that ran out by itself says nothing to this server: its link is dropped here, once the hub confirms it.
    const links = await this.links.exclusive(async () => {
      for (const link of await this.links.all()) {
        if (found.has(link.contactId)) continue;
        const account = await this.accountNow(admin, link.contactId);
        if (account && isPartner(account)) found.set(account.id, account);
        else await this.links.remove(link.contactId);
      }
      return this.links.all();
    });
    const byContact = new Map(links.map((link) => [link.contactId, link]));
    // Those still waiting for a project lead the list.
    const partners = [...found.values()]
      .map((account) => {
        const link = byContact.get(account.id);
        return { contactId: account.id, name: account.name || account.email, phone: account.phone, since: account.partner_since ?? '', end: account.partner_end ?? '', left: account.partner_left ?? null, project: link ? this.currentProject(link.project) : null };
      })
      .sort((a, b) => Number(Boolean(a.project)) - Number(Boolean(b.project)) || b.since.localeCompare(a.since) || b.contactId - a.contactId);
    const holders = new Map(links.map((link) => [link.project.id, { contactId: link.contactId, name: found.get(link.contactId)?.name || found.get(link.contactId)?.email || '' }]));
    const projects = this.deps.projects
      .all()
      .map((project) => ({ id: project.id, number: project.number, title: project.title, url: this.deps.projects.pageUrl(project.id), holder: holders.get(project.id) ?? null }))
      .sort((a, b) => b.id - a.id);
    return { partners, projects };
  }

  /** Name, number and public page only (rule 4), as the bank has them today; the stored ones once a project has left the feed. */
  private currentProject(stored: PartnerProject): ShownProject {
    const live = this.deps.projects.get(stored.id);
    return live ? { id: live.id, number: live.number, title: live.title, url: this.deps.projects.pageUrl(live.id) } : { ...stored, url: null };
  }

  private bankProject(projectId: number | null): PartnerProject {
    if (!projectId) throw new RequestError('project_required', PICK_PROJECT, 400);
    const project = this.deps.projects.get(projectId);
    if (!project) throw new RequestError('project_unknown', 'المشروع المختار غير موجود في بنك المشاريع: حدّث الصفحة واختر من القائمة', 400);
    return { id: project.id, number: project.number, title: project.title };
  }

  private newLink(admin: AdminActor, contactId: number, project: PartnerProject): PartnerLink {
    return { contactId, project, linkedAt: new Date().toISOString(), by: admin.me.name || admin.me.email };
  }

  /** The account as the hub has it this moment; null when the hub no longer knows it. */
  private async accountNow(admin: AdminActor, contactId: number): Promise<HubAccount | null> {
    try {
      return (await this.hub(admin, 'admin_member', { contact_id: contactId }, false)).account;
    } catch (error) {
      if (error instanceof HubError && error.code === 'not_found') return null;
      throw error;
    }
  }

  /** Inside `links.exclusive`: refuses a project a running partner holds, and frees one whose holder no longer is one. */
  private async assertFree(admin: AdminActor, project: PartnerProject, contactId: number): Promise<void> {
    for (const link of await this.links.all()) {
      if (link.project.id !== project.id || link.contactId === contactId) continue;
      const holder = await this.accountNow(admin, link.contactId);
      if (holder && isPartner(holder)) throw new RequestError('project_taken', `هذا المشروع مرتبط بالفعل بشريك النجاح «${holder.name || holder.email}» (حساب رقم ${holder.id}). المشروع الواحد لا يرتبط إلا بشريك واحد`, 409);
      await this.links.remove(link.contactId);
    }
  }

  /** After a revoke or a deletion, which are already done: a link that cannot be removed now is dropped by its next reader. */
  private async freeProject(contactId: number): Promise<void> {
    await this.links.exclusive(() => this.links.remove(contactId)).catch((error: unknown) => this.deps.log.error({ err: error, contactId }, 'partner project not freed'));
  }

  /**
   * M216 «حذف فوري للحساب» (owner, 2026-11-07): an admin session, `confirm: true`, a reason and one audit entry; the hub
   * wipes the account (`admin_delete`, 2.30.0) and its row stays emptied, so payments and invoices keep pointing at it.
   * Every session and push token of the account ends here, and his 30-day request, if any, is closed. An admin account
   * and the actor's own are refused here and again on the hub. A store subscription lives at Apple or Google: the
   * dashboard says so before the confirm, and the hub refuses a later renewal on the emptied row.
   */
  async deleteAccount(admin: AdminActor, contactId: number, input: { note: string; tellMember: boolean; requestId: string | null }) {
    const { account } = await this.hub(admin, 'admin_member', { contact_id: contactId }, false);
    return this.write(admin, 'delete', contactId, { params: { name: account.name, state: account.state, tellMember: input.tellMember }, note: input.note, requestId: input.requestId }, async () => {
      if (contactId === admin.me.id) throw new HubError('self_delete', 'لا يمكن حذف حسابك من لوحة التحكم', 403);
      if (account.role === 'admin') throw new HubError('admin_account', 'لا يمكن حذف حساب مدير', 403);
      let result: HubResults['admin_delete'];
      try {
        result = await this.hub(admin, 'admin_delete', { contact_id: contactId, note: input.note }, false);
      } catch (error) {
        if (error instanceof HubError && error.code === 'not_found' && (await this.hubBefore(HUB_DELETE_VERSION))) throw new HubError('hub_not_supported', UPGRADE_HUB_DELETE, 501);
        throw error;
      }
      await this.deps.auth.endSessions(contactId);
      await this.deps.push.forgetContact(contactId);
      await this.deps.deletion?.cancel(contactId);
      await this.deps.postOpens?.forgetContact(contactId);
      await this.freeProject(contactId);
      this.bust('hub', 'pb');
      if (!result.already) {
        const email = result.email || account.email;
        if (input.tellMember) this.deps.notifier?.tellAccountDeleted(email, result.lang === 'en' ? 'en' : 'ar', account.name);
        // M235: the same notice on the number the account held (the hub's row is emptied by now).
        if (input.tellMember) void this.deps.whatsapp?.sendNotice('account_deleted', { phone: account.phone, lang: result.lang, name: account.name, ref: `deleted:${contactId}` });
        this.deps.notifier?.accountDeletedByAdmin({ name: account.name, phone: account.phone, email, contactId, by: admin.me.name || admin.me.email, note: input.note, told: input.tellMember });
      }
      return { ok: true as const };
    });
  }

  /** True only when the hub answered a real version older than `wanted` (the mock and an unknown version pass). */
  private async hubBefore(wanted: number[]): Promise<boolean> {
    const version = (await this.bridge()).hub.version;
    return Boolean(version) && !String(version).endsWith('-mock') && !atLeast(version, wanted);
  }

  setRole(admin: AdminActor, contactId: number, input: { role: 'member' | 'publisher'; note: string; requestId: string | null }) {
    return this.write(admin, 'role', contactId, { params: { role: input.role }, note: input.note, requestId: input.requestId }, async () => {
      const result = await this.hub(admin, 'admin_set_role', { contact_id: contactId, role: input.role }, false);
      this.deps.auth.forget(contactId);
      this.bust('hub');
      return { ok: true as const, contact: result.contact };
    });
  }

  /** M283: the dashboard changes a member's category (owner: members who picked «محايد» by mistake). */
  setPersona(admin: AdminActor, contactId: number, input: { persona: Persona; note: string; requestId: string | null }) {
    return this.write(admin, 'persona', contactId, { params: { persona: input.persona }, note: input.note, requestId: input.requestId }, async () => {
      const applied = await this.deps.auth.applyPersonaForContact(contactId, input.persona);
      if (!applied) throw new RequestError('member_session_gone', 'تعذّر تغيير الفئة: لا توجد جلسة مفتوحة لهذا العضو في التطبيق — اطلب منه فتح التطبيق وتسجيل الدخول ثم أعد المحاولة', 409);
      this.deps.auth.forget(contactId);
      this.bust('hub');
      return { ok: true as const, persona: input.persona };
    });
  }

  pbGrant(admin: AdminActor, contactId: number, input: { amount: number; note: string; requestId: string | null }) {
    return this.write(admin, 'pb_grant', contactId, { params: { amount: input.amount }, note: input.note, requestId: input.requestId }, async () => {
      // PB files a grant under the member's current year, which only the hub knows.
      const { account } = await this.hub(admin, 'admin_member', { contact_id: contactId });
      if (account.state !== 'member') throw new RequestError('not_member', 'رصيد بنك المشاريع يُضاف للأعضاء المشتركين فقط', 409);
      const result = await this.deps.pb.grant({ contactId, amount: input.amount, note: input.note, actor: admin.me.name || admin.me.email, member: toPbMember(account) });
      this.bust('pb');
      // M235: the member hears of the added «رصيد» on WhatsApp.
      if (result.granted > 0) void tellMember(this.deps, contactId, 'pb_credit', [result.granted, result.left]);
      return { ok: true as const, granted: result.granted, left: result.left };
    });
  }

  reply(admin: AdminActor, contactId: number, text: string, requestId: string | null) {
    return this.write(admin, 'reply', contactId, { params: { length: text.length, excerpt: text.slice(0, 80) }, note: '', requestId }, async () => {
      const result = await this.hub(admin, 'admin_reply', { contact_id: contactId, text }, false);
      this.bust('threads');
      // M235 (owner: «لما يجيله رسالة من الإدارة توصل واتس اب برده»): the words stay in the app; WhatsApp says one arrived.
      void tellMember(this.deps, contactId, 'admin_reply', [], `reply:${contactId}:${result.message_id}`);
      return { ok: true as const, message_id: result.message_id };
    });
  }
}
