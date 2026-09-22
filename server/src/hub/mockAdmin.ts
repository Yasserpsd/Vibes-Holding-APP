import { DAY_MS, hubTime, lastRiyadhDays, riyadhDay } from '../riyadh.js';
import type { MockChat, MockThreadRow } from './mockChat.js';
import { MOCK_SITES, nextId, type MockContact, type MockEvent, type MockState } from './mockData.js';
import {
  HubError,
  type HubAccount,
  type HubAccountState,
  type HubBody,
  type HubContact,
  type HubEvent,
  type HubLead,
  type HubPayment,
  type HubResults,
  type HubStatsDay,
  type HubThread,
  type HubTicket,
} from './types.js';

/**
 * Bridge v2 ops of the in-memory hub (docs/BRIDGE_V2.md 1.2 to 1.4), computed from the mock's contacts,
 * events and conversations the way plugin 2.7.0 computes them from its tables. The mock's site is trusted;
 * `admin_*` still needs the uuid of a verified admin account and `publish` an admin or a publisher.
 */
export const MOCK_HUB_VERSION = '2.7.2-mock';
const MOCK_DAILY_LIMIT = 20;
const LEAD_WEIGHTS: Record<string, number> = { payment: 4, partner: 3, membership: 3, service: 2, cooperation: 2, owner: 1, management: 1 };

const str = (body: HubBody, key: string, max = 500): string => (typeof body[key] === 'string' ? (body[key] as string).trim().slice(0, max) : '');
const int = (body: HubBody, key: string, fallback: number, min: number, max: number): number => {
  const value = Number(body[key]);
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function paged<T>(rows: T[], body: HubBody): { total: number; page: number; per_page: number; items: T[] } {
  const perPage = int(body, 'per_page', 25, 1, 100);
  const page = int(body, 'page', 1, 1, 100_000);
  return { total: rows.length, page, per_page: perPage, items: rows.slice((page - 1) * perPage, page * perPage) };
}

type Deps = { state: MockState; chat: MockChat; visitors: Map<string, number>; publicContact: (contact: MockContact) => HubContact };

export class MockAdmin {
  /** Last message id an admin has seen per conversation (`admin_seen_id` in the plugin). */
  private readonly seen = new Map<number, number>();

  constructor(private readonly deps: Deps) {}

  /** `member_change()` of the plugin: one primitive for the store, the dashboard and the payment paths. */
  memberChange(contact: MockContact, action: 'activate' | 'extend' | 'revoke', days: number, source: string, ref: string, actorId: number, note: string, now = Date.now()): { event: MockEvent; already: boolean } {
    const { state } = this.deps;
    const known = ref ? state.events.find((event) => event.source === source && event.ref === ref) : undefined;
    if (known) return { event: known, already: true };
    const record = (kind: MockEvent['kind'], length: number): MockEvent => {
      const event: MockEvent = { id: nextId(state, 'event'), contactId: contact.id, kind, days: length, source, ref, actorId, note, at: now };
      state.events.push(event);
      return event;
    };
    if (action === 'revoke') {
      Object.assign(contact, { isMember: false, memberStartedAt: null, memberDays: 0 });
      return { event: record('revoked', 0), already: false };
    }
    const length = Number.isInteger(days) && days > 0 ? days : 365;
    const active = contact.isMember && contact.memberStartedAt !== null && contact.memberStartedAt + contact.memberDays * DAY_MS > now;
    const before = state.events.some((event) => event.contactId === contact.id && (event.kind === 'activated' || event.kind === 'renewed'));
    if (active) {
      // Remaining days are never lost: the start stays and the period grows.
      contact.memberDays += length;
    } else {
      Object.assign(contact, { isMember: true, memberStartedAt: now, memberDays: length });
    }
    return { event: record(before || active ? 'renewed' : 'activated', length), already: false };
  }

  event(contactId: number, kind: MockEvent['kind'], extra: Partial<MockEvent> = {}): void {
    const { state } = this.deps;
    state.events.push({ id: nextId(state, 'event'), contactId, kind, days: 0, source: 'app', ref: '', actorId: 0, note: '', at: Date.now(), ...extra });
  }

  /** The admin behind a dashboard call: the hub decides who is one (rule 2). */
  private requireRole(body: HubBody, roles: string[]): MockContact {
    const uuid = str(body, 'uuid', 64);
    const id = this.deps.visitors.get(uuid);
    const contact = id ? this.deps.state.contacts.get(id) : undefined;
    if (!contact || !contact.verified || !roles.includes(contact.role)) throw new HubError('not_admin', 'هذا الحساب ليس من إدارة النادي', 403);
    return contact;
  }

  private target(body: HubBody): MockContact {
    const contact = this.deps.state.contacts.get(Number(body.contact_id));
    if (!contact) throw new HubError('no_contact', 'الحساب غير موجود', 404);
    return contact;
  }

  private stateOf(contact: MockContact, now: number): HubAccountState {
    if (!contact.verified) return contact.passHash ? 'pending' : 'lead';
    if (!contact.isMember) return 'unpaid';
    return contact.memberStartedAt === null || contact.memberStartedAt + contact.memberDays * DAY_MS > now ? 'member' : 'expired';
  }

  private intent(contact: MockContact, state: HubAccountState, messages: number): { intent: number; intent_label: string } {
    let score = 9;
    if (state !== 'member') {
      const leadScore = this.deps.state.leads.filter((lead) => lead.contactId === contact.id).reduce((sum, lead) => sum + (LEAD_WEIGHTS[lead.ltype] ?? 0), 0);
      score = Math.min(9, leadScore + (contact.passHash ? 1 : 0) + (messages >= 6 ? 1 : 0) + (messages >= 14 ? 1 : 0) + (contact.persona === 'investor' ? 1 : 0) + (contact.memo ? 1 : 0));
    }
    return { intent: score, intent_label: score >= 6 ? 'جاد جدًا' : score >= 4 ? 'مهتم' : score >= 2 ? 'يستكشف' : 'بارد' };
  }

  private account(contact: MockContact, threads: Map<number, MockThreadRow[]>, now: number): HubAccount {
    const view = this.deps.publicContact(contact);
    const state = this.stateOf(contact, now);
    const rows = threads.get(contact.id) ?? [];
    return {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      state,
      role: contact.role,
      persona: contact.persona,
      job_title: contact.jobTitle,
      company: contact.company,
      city: contact.city,
      created_at: hubTime(contact.createdAt),
      verified_at: contact.verifiedAt !== null ? hubTime(contact.verifiedAt) : null,
      last_at: contact.lastAt !== null || rows.length ? hubTime(Math.max(contact.lastAt ?? 0, rows.at(-1)?.at ?? 0)) : null,
      last_login_at: contact.lastLoginAt !== null ? hubTime(contact.lastLoginAt) : null,
      site: contact.site,
      msg_count: rows.filter((row) => row.role === 'user').length,
      is_member: state === 'member' ? 1 : 0,
      member_left: view.member_left,
      member_days: contact.isMember ? contact.memberDays : 0,
      member_end: view.member_end,
      never_expires: contact.isMember && contact.memberStartedAt === null ? 1 : 0,
      daily_limit: MOCK_DAILY_LIMIT,
      daily_left: view.daily_left,
      ...this.intent(contact, state, rows.length),
      has_password: contact.passHash ? 1 : 0,
      referred_by: contact.referredBy,
    };
  }

  private threadMap(now: number): Map<number, MockThreadRow[]> {
    return new Map(this.deps.chat.threads(now).map((thread) => [thread.contactId, thread.rows]));
  }

  private matches(contact: MockContact, q: string): boolean {
    if (!q) return true;
    const needle = q.toLowerCase();
    return [contact.name, contact.email, contact.phone, contact.phoneNorm, contact.company].some((value) => value.toLowerCase().includes(needle));
  }

  private payment(row: MockState['payments'][number]): HubPayment {
    const contact = this.deps.state.contacts.get(row.contactId);
    return { id: row.id, txn_id: row.txnId, order_id: row.orderId, amount_cents: row.amountCents, currency: row.currency, success: row.success ? 1 : 0, action: row.action, name: contact?.name ?? '', phone: contact?.phone ?? '', email: contact?.email ?? '', contact_id: row.contactId, note: row.note, created_at: hubTime(row.at) };
  }

  private ticket(row: MockState['tickets'][number]): HubTicket {
    const contact = this.deps.state.contacts.get(row.contactId);
    return { id: row.id, ref: row.ref, contact_id: row.contactId, name: contact?.name ?? '', phone: contact?.phone ?? '', email: contact?.email ?? '', event_title: row.eventTitle, event_date: row.eventDate, event_place: row.eventPlace, source: row.source, checked_in: row.checkedIn ? 1 : 0, created_at: hubTime(row.at) };
  }

  private lead(row: MockState['leads'][number], threads: Map<number, MockThreadRow[]>, now: number): HubLead {
    const contact = this.deps.state.contacts.get(row.contactId);
    const intent = contact ? this.intent(contact, this.stateOf(contact, now), threads.get(contact.id)?.length ?? 0) : { intent: 0, intent_label: 'بارد' };
    return { id: row.id, contact_id: row.contactId, name: contact?.name ?? '', phone: contact?.phone ?? '', site: row.site, ltype: row.ltype, reason: row.reason, company: row.company, notes: row.notes, status: row.status, ...intent, created_at: hubTime(row.at) };
  }

  private eventRow(row: MockEvent): HubEvent {
    return { id: row.id, contact_id: row.contactId, kind: row.kind, days: row.days, source: row.source, ref: row.ref, actor_id: row.actorId, actor_name: this.deps.state.contacts.get(row.actorId)?.name ?? '', note: row.note, created_at: hubTime(row.at) };
  }

  stats(body: HubBody, now = Date.now()): HubResults['admin_stats'] {
    this.requireRole(body, ['admin']);
    const { state } = this.deps;
    const days = int(body, 'days', 30, 7, 180);
    const threads = this.threadMap(now);
    const contacts = [...state.contacts.values()];
    const states = contacts.map((contact) => this.stateOf(contact, now));
    const count = (wanted: HubAccountState): number => states.filter((value) => value === wanted).length;

    const blank = (day: string): HubStatsDay => ({ day, signups: 0, verified: 0, activations: 0, renewals: 0, payments_count: 0, payments_cents: 0, conversations: 0, messages: 0, leads: 0 });
    const series = new Map(lastRiyadhDays(days, now).map((day) => [day, blank(day)]));
    const bump = (at: number, change: (row: HubStatsDay) => void): void => {
      const row = series.get(riyadhDay(at));
      if (row) change(row);
    };
    for (const event of state.events) {
      if (event.kind === 'registered') bump(event.at, (row) => void (row.signups += 1));
      if (event.kind === 'verified') bump(event.at, (row) => void (row.verified += 1));
      if (event.kind === 'activated') bump(event.at, (row) => void (row.activations += 1));
      if (event.kind === 'renewed') bump(event.at, (row) => void (row.renewals += 1));
    }
    for (const payment of state.payments) {
      if (payment.success) bump(payment.at, (row) => void ((row.payments_count += 1), (row.payments_cents += payment.amountCents)));
    }
    for (const lead of state.leads) bump(lead.at, (row) => void (row.leads += 1));
    const perSite = new Map<string, { conversations: Set<number>; messages: number }>();
    const today = riyadhDay(now);
    const repliedToday = new Set<number>();
    let repliesToday = 0;
    for (const [contactId, rows] of threads) {
      const talked = new Set<string>();
      const host = state.contacts.get(contactId)?.site ?? 'app';
      for (const message of rows) {
        const day = riyadhDay(message.at);
        const row = series.get(day);
        if (!row) continue;
        row.messages += 1;
        if (message.role === 'user' && !talked.has(day)) {
          talked.add(day);
          row.conversations += 1;
        }
        const site = perSite.get(host) ?? { conversations: new Set<number>(), messages: 0 };
        site.messages += 1;
        site.conversations.add(contactId);
        perSite.set(host, site);
        if (message.role === 'assistant' && day === today) {
          repliesToday += 1;
          repliedToday.add(contactId);
        }
      }
    }

    const expiring = contacts
      .map((contact) => ({ contact, view: this.deps.publicContact(contact) }))
      .filter(({ view }) => view.is_member === 1 && view.member_left !== null && view.member_left <= 30)
      .sort((a, b) => (a.view.member_left ?? 0) - (b.view.member_left ?? 0));
    const { day: _day, ...todayRow } = series.get(today) ?? blank(today);
    return {
      ok: true,
      generated_at: hubTime(now),
      tz: 'Asia/Riyadh',
      days,
      totals: {
        contacts: contacts.length,
        leads: count('lead'),
        // As the plugin counts it: accounts = members_active + members_expired + unpaid (a member who never confirmed his e-mail is an account too).
        accounts: contacts.filter((contact) => contact.verified || contact.isMember).length,
        pending_email: count('pending'),
        unpaid: count('unpaid'),
        members_active: count('member'),
        members_expired: count('expired'),
        members_no_expiry: contacts.filter((contact) => contact.isMember && contact.memberStartedAt === null).length,
        admins: contacts.filter((contact) => contact.verified && contact.role === 'admin').length,
        publishers: contacts.filter((contact) => contact.verified && contact.role === 'publisher').length,
      },
      today: todayRow,
      expiring: {
        d7: expiring.filter(({ view }) => (view.member_left ?? 99) <= 7).length,
        d30: expiring.length,
        items: expiring.slice(0, 20).map(({ contact, view }) => ({ id: contact.id, name: contact.name, phone: contact.phone, email: contact.email, member_end: view.member_end, days_left: view.member_left ?? 0 })),
      },
      series: [...series.values()],
      per_site: [...perSite].map(([host, site]) => ({ host, name: MOCK_SITES[host] ?? host, conversations: site.conversations.size, messages: site.messages })).sort((a, b) => b.messages - a.messages),
      mail: this.mailStats(),
      ai: { replies_today: repliesToday, members_today: [...repliedToday].filter((id) => this.deps.state.contacts.get(id)?.isMember).length },
    };
  }

  accounts(body: HubBody, now = Date.now()): HubResults['admin_accounts'] {
    this.requireRole(body, ['admin']);
    const threads = this.threadMap(now);
    const q = str(body, 'q', 120);
    const wanted = str(body, 'state', 20) || 'all';
    const rows = [...this.deps.state.contacts.values()].filter((contact) => this.matches(contact, q)).map((contact) => this.account(contact, threads, now));
    const belongs = (row: HubAccount, state: string): boolean => {
      if (state === 'all') return row.state !== 'lead';
      if (state === 'admin' || state === 'publisher') return row.role === state && row.state !== 'lead' && row.state !== 'pending';
      return row.state === state;
    };
    const counts = Object.fromEntries(['all', 'pending', 'unpaid', 'member', 'expired', 'admin', 'publisher', 'lead'].map((state) => [state, rows.filter((row) => belongs(row, state)).length]));
    const listed = rows.filter((row) => belongs(row, wanted)).sort((a, b) => b.id - a.id);
    return { ok: true, ...paged(listed, body), counts };
  }

  member(body: HubBody, now = Date.now()): HubResults['admin_member'] {
    this.requireRole(body, ['admin']);
    const contact = this.target(body);
    const { state } = this.deps;
    const threads = this.threadMap(now);
    const last = <T extends { at: number; id: number }>(rows: T[]): T[] => [...rows].sort((a, b) => b.at - a.at || b.id - a.id).slice(0, 50);
    return {
      ok: true,
      account: this.account(contact, threads, now),
      memo: contact.memo,
      notes: contact.notes,
      sites: [contact.site],
      payments: last(state.payments.filter((row) => row.contactId === contact.id)).map((row) => this.payment(row)),
      tickets: last(state.tickets.filter((row) => row.contactId === contact.id)).map((row) => this.ticket(row)),
      leads: last(state.leads.filter((row) => row.contactId === contact.id)).map((row) => this.lead(row, threads, now)),
      events: last(state.events.filter((row) => row.contactId === contact.id)).map((row) => this.eventRow(row)),
    };
  }

  payments(body: HubBody): HubResults['admin_payments'] {
    this.requireRole(body, ['admin']);
    const q = str(body, 'q', 120).toLowerCase();
    const status = str(body, 'status', 10) || 'all';
    const action = str(body, 'action', 40);
    const rows = this.deps.state.payments
      .filter((row) => (status === 'ok' ? row.success : status === 'failed' ? !row.success : true) && (!action || row.action === action))
      .map((row) => this.payment(row))
      .filter((row) => !q || [row.name, row.email, row.phone, row.txn_id, row.order_id].some((value) => value.toLowerCase().includes(q)))
      .sort((a, b) => b.id - a.id);
    return { ok: true, ...paged(rows, body), sum_cents_ok: rows.reduce((sum, row) => sum + (row.success ? row.amount_cents : 0), 0) };
  }

  tickets(body: HubBody): HubResults['admin_tickets'] {
    this.requireRole(body, ['admin']);
    const q = str(body, 'q', 120).toLowerCase();
    const rows = this.deps.state.tickets
      .map((row) => this.ticket(row))
      .filter((row) => !q || [row.name, row.email, row.phone, row.ref, row.event_title].some((value) => value.toLowerCase().includes(q)))
      .sort((a, b) => b.id - a.id);
    return { ok: true, ...paged(rows, body) };
  }

  leads(body: HubBody, now = Date.now()): HubResults['admin_leads'] {
    this.requireRole(body, ['admin']);
    const threads = this.threadMap(now);
    const q = str(body, 'q', 120).toLowerCase();
    const ltype = str(body, 'ltype', 40);
    const rows = this.deps.state.leads
      .filter((row) => !ltype || row.ltype === ltype)
      .map((row) => this.lead(row, threads, now))
      .filter((row) => !q || [row.name, row.phone, row.company, row.reason].some((value) => value.toLowerCase().includes(q)))
      .sort((a, b) => b.id - a.id);
    return { ok: true, ...paged(rows, body) };
  }

  threads(body: HubBody, now = Date.now()): HubResults['admin_threads'] {
    this.requireRole(body, ['admin']);
    const q = str(body, 'q', 120);
    const filter = str(body, 'filter', 20) || 'all';
    const rows: HubThread[] = [];
    for (const [contactId, messages] of this.threadMap(now)) {
      const contact = this.deps.state.contacts.get(contactId);
      const lastRow = messages.at(-1);
      if (!contact || !lastRow || !this.matches(contact, q)) continue;
      const state = this.stateOf(contact, now);
      const seen = this.seen.get(contactId) ?? 0;
      const lastStaff = [...messages].reverse().find((row) => row.role !== 'user');
      rows.push({
        contact_id: contactId,
        name: contact.name,
        phone: contact.phone,
        site: contact.site,
        last_text: lastRow.content.slice(0, 160),
        last_role: lastRow.role,
        last_at: hubTime(lastRow.at),
        unread: messages.filter((row) => row.role === 'user' && row.id > seen).length,
        waiting: lastRow.role === 'user' ? 1 : 0,
        human: lastStaff?.role === 'human' ? 1 : 0,
        is_member: state === 'member' ? 1 : 0,
        ...this.intent(contact, state, messages.length),
      });
    }
    const listed = rows
      .filter((row) => (filter === 'waiting' ? row.waiting === 1 : filter === 'human' ? row.human === 1 : filter === 'unread' ? row.unread > 0 : true))
      .sort((a, b) => b.last_at.localeCompare(a.last_at));
    return { ok: true, ...paged(listed, body) };
  }

  thread(body: HubBody, now = Date.now()): HubResults['admin_thread'] {
    this.requireRole(body, ['admin']);
    const contact = this.target(body);
    const threads = this.threadMap(now);
    const before = int(body, 'before', 0, 0, Number.MAX_SAFE_INTEGER);
    const rows = (threads.get(contact.id) ?? []).filter((row) => !before || row.id < before);
    const page = rows.slice(-40);
    const newest = page.at(-1);
    if (newest && !before) this.seen.set(contact.id, newest.id);
    return {
      ok: true,
      account: this.account(contact, threads, now),
      messages: page.map((row) => ({ id: row.id, role: row.role, content: row.content, by: row.by, page_url: row.pageUrl, at: hubTime(row.at) })),
      has_more: rows.length > page.length,
    };
  }

  reply(body: HubBody): HubResults['admin_reply'] {
    const admin = this.requireRole(body, ['admin']);
    const contact = this.target(body);
    const text = str(body, 'text', 4000);
    if (!text) throw new HubError('empty', 'الرسالة فارغة', 400);
    const id = this.deps.chat.staffReply(contact.id, text, admin.name);
    contact.lastAt = Date.now();
    return { ok: true, message_id: id };
  }

  private mailStats(): { pending: number; sent: number; failed: number } {
    const count = (status: string): number => this.deps.state.mail.filter((row) => row.status === status).length;
    return { pending: count('pending'), sent: count('sent'), failed: count('failed') };
  }

  mail(body: HubBody): HubResults['admin_mail'] {
    this.requireRole(body, ['admin']);
    const items = [...this.deps.state.mail]
      .sort((a, b) => b.id - a.id)
      .slice(0, 50)
      .map((row) => ({ id: row.id, to_email: row.toEmail, subject: row.subject, kind: row.kind, status: row.status, attempts: row.attempts, created_at: hubTime(row.at), sent_at: row.sentAt !== null ? hubTime(row.sentAt) : null }));
    return { ok: true, stats: this.mailStats(), items };
  }

  grant(body: HubBody): HubResults['admin_grant'] {
    const admin = this.requireRole(body, ['admin']);
    const contact = this.target(body);
    const action = str(body, 'action', 20);
    if (action !== 'activate' && action !== 'extend' && action !== 'revoke') throw new HubError('invalid', 'إجراء غير معروف', 400);
    if (!contact.verified) throw new HubError('invalid', 'الحساب غير مفعّل بالبريد بعد', 400);
    const days = Number(body.days);
    if (action !== 'revoke' && (!Number.isInteger(days) || days < 1 || days > 3650)) throw new HubError('invalid', 'عدد الأيام غير صحيح', 400);
    const { event } = this.memberChange(contact, action, days, 'admin', '', admin.id, str(body, 'note', 300));
    return { ok: true, contact: this.deps.publicContact(contact), event: this.eventRow(event) };
  }

  setRole(body: HubBody): HubResults['admin_set_role'] {
    const admin = this.requireRole(body, ['admin']);
    const contact = this.target(body);
    const role = str(body, 'role', 20);
    if (role !== 'member' && role !== 'publisher') throw new HubError('invalid', 'الدور غير معروف', 400);
    if (!contact.verified) throw new HubError('invalid', 'الحساب غير مفعّل بالبريد بعد', 400);
    // Admin promotion and demotion stay on the hub page (it has its own code step).
    if (contact.role === 'admin') throw new HubError('invalid', 'دور الإدارة يُدار من صفحة الهب فقط', 400);
    contact.role = role;
    this.event(contact.id, 'role', { source: 'admin', actorId: admin.id, note: role });
    return { ok: true, contact: this.deps.publicContact(contact) };
  }

  changes(body: HubBody): HubResults['changes'] {
    const since = int(body, 'since_id', 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = int(body, 'limit', 30, 1, 100);
    const kinds = Array.isArray(body.kinds) ? body.kinds.filter((kind): kind is string => typeof kind === 'string') : [];
    const rows = this.deps.state.knowledge.filter((row) => row.id > since && (!kinds.length || kinds.includes(row.kind))).sort((a, b) => b.id - a.id);
    const items = (since ? rows.slice(-limit) : rows.slice(0, Math.min(limit, 30))).map((row) => ({ id: row.id, host: row.host, site: row.site, url: row.url, title: row.title, kind: row.kind, excerpt: row.excerpt.slice(0, 300), updated_at: hubTime(row.at) }));
    return { ok: true, cursor: Math.max(since, ...this.deps.state.knowledge.map((row) => row.id)), items };
  }

  publish(body: HubBody, now = Date.now()): HubResults['publish'] {
    this.requireRole(body, ['admin', 'publisher']);
    const { state } = this.deps;
    const key = str(body, 'key', 80);
    if (!key) throw new HubError('invalid', 'مفتاح المنشور مطلوب', 400);
    const url = `app://posts/${key}`;
    const existing = state.knowledge.find((row) => row.url === url);
    if (body.remove === true) {
      state.knowledge = state.knowledge.filter((row) => row.url !== url);
      state.cards.delete(key);
      return { ok: true, id: existing?.id ?? 0 };
    }
    const kind = str(body, 'kind', 10) === 'event' ? 'event' : 'post';
    const title = str(body, 'title', 200);
    if (!title) throw new HubError('invalid', 'العنوان مطلوب', 400);
    const content = str(body, 'content', 8000);
    const raw = isRecord(body.event) ? body.event : null;
    const event = kind === 'event' && raw ? { date: str(raw, 'date', 40), place: str(raw, 'place', 200), online_url: str(raw, 'online_url', 600) } : null;
    // A changed row gets a new id, the way the plugin's knowledge cursor moves on every update.
    const id = nextId(state, 'knowledge');
    state.knowledge = state.knowledge.filter((row) => row.url !== url);
    state.knowledge.push({ id, host: 'app', site: MOCK_SITES.app ?? 'app', url, title, kind: kind === 'event' ? 'app_event' : 'app_post', excerpt: content.slice(0, 300), at: now });
    state.cards.set(key, { key, kind, title, excerpt: content.slice(0, 300), url: str(body, 'url', 600), image: str(body, 'image', 600), event, at: now });
    return { ok: true, id };
  }

  feed(body: HubBody): HubResults['feed'] {
    const kind = str(body, 'kind', 10);
    const limit = int(body, 'limit', 6, 1, 12);
    const items = [...this.deps.state.cards.values()]
      .filter((card) => !kind || card.kind === kind)
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
      .map((card) => ({ key: card.key, kind: card.kind, title: card.title, excerpt: card.excerpt, url: card.url, image: card.image, event: card.event, at: hubTime(card.at) }));
    return { ok: true, items };
  }
}
