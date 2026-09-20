import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { RequestError } from '../auth/guard.js';
import { DAY_MS, hubTime } from '../riyadh.js';
import type { PublicProject } from './types.js';

/**
 * Projects Bank bridge (plugin 39.0, docs/BRIDGE_V2.md 2): `POST {PB_BRIDGE_URL}/{op}` with the header-only key.
 * PB keeps no balance and cannot ask the hub, so every member call carries the member's period as the hub reports it.
 * Founder contact data exists only in the answer of `unlock` for that member (CLAUDE.md rule 4): nothing here stores it.
 */
export type PbMember = { contact_id: number; member_end: string; member_days: number; name: string; email: string; phone: string };
export type PbBalanceLite = { credits: number; granted: number; used: number; left: number };
export type PbBalance = PbBalanceLite & { period_start: string; unlocked: number[] };
export type PbContact = { whatsapp: string; email: string; website: string; pitch_url: string };
export type PbUnlock = { already: boolean; left: number; contact: PbContact };
export type PbUnlockRow = { contact_id: number; pid: number; title: string; name: string; unlocked_at: string };
export type PbGrantInput = { contactId: number; amount: number; note: string; actor: string; member?: PbMember };

export interface PbBridge {
  readonly mode: 'live' | 'mock' | 'off';
  ping(): Promise<{ version: string }>;
  balance(member: PbMember): Promise<PbBalance>;
  /** At most 200 members per call; the answer is keyed by contact id. */
  balances(members: PbMember[]): Promise<Record<string, PbBalanceLite>>;
  unlock(member: PbMember, pid: number): Promise<PbUnlock>;
  grant(input: PbGrantInput): Promise<{ granted: number; left: number }>;
  unlocks(query: { page: number; perPage: number; contactId?: number }): Promise<{ total: number; items: PbUnlockRow[] }>;
}

export const PB_BATCH = 200;
const TIMEOUT_MS = 15_000;
const NOT_SUPPORTED = 'حدّث إضافة بنك المشاريع إلى 39.0';

const count = z.coerce.number().int();
const text = z.string().catch('');
const liteSchema = z.object({ credits: count, granted: count.catch(0), used: count, left: count });
const schemas = {
  ping: z.object({ version: z.coerce.string().max(40) }),
  balance: liteSchema.extend({ period_start: text, unlocked: z.array(count).catch([]) }),
  balances: z.object({ items: z.record(z.string(), liteSchema).catch({}) }),
  unlock: z.object({ already: z.coerce.boolean().catch(false), left: count, contact: z.object({ whatsapp: text, email: text, website: text, pitch_url: text }) }),
  grant: z.object({ granted: count, left: count }),
  unlocks: z.object({ total: count, items: z.array(z.object({ contact_id: count, pid: count, title: text, name: text, unlocked_at: text })).catch([]) }),
};
type Op = keyof typeof schemas;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * WordPress may print a PHP notice around the JSON; the answer itself is still in there. The text is never kept or
 * logged, only its length.
 */
function parseAnswer(raw: string): { value: unknown; parsed: boolean; length: number } {
  const candidates = [raw, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)];
  for (const candidate of candidates) {
    try {
      return { value: JSON.parse(candidate) as unknown, parsed: true, length: raw.length };
    } catch {
      // Not JSON: the next candidate, then handled by the caller.
    }
  }
  return { value: null, parsed: false, length: raw.length };
}

type LiveOptions = { url: string; key: string; log: FastifyBaseLogger; fetchImpl?: typeof fetch };

export class LivePbBridge implements PbBridge {
  readonly mode = 'live' as const;
  private readonly base: string;

  constructor(private readonly options: LiveOptions) {
    this.base = options.url.replace(/\/+$/, '');
  }

  private async call<K extends Op>(op: K, body: Record<string, unknown>): Promise<z.infer<(typeof schemas)[K]>> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(`${this.base}/${op}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8', accept: 'application/json', 'x-pb-bridge-key': this.options.key, 'user-agent': 'InvestorsClubServer/0.1' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.options.log.warn({ op, err: error }, 'Projects Bank bridge unreachable');
      throw new RequestError('pb_unreachable', 'تعذّر الاتصال ببنك المشاريع الآن، حاول بعد قليل', 502);
    }
    const answer = parseAnswer(await response.text());
    const json = answer.value;
    if (response.ok && isRecord(json) && json.ok === true) {
      const parsed = schemas[op].safeParse(json);
      if (parsed.success) return parsed.data as z.infer<(typeof schemas)[K]>;
      this.options.log.error({ op, issues: parsed.error.issues.slice(0, 3).map((issue) => ({ path: issue.path.join('.'), code: issue.code })) }, 'unexpected Projects Bank bridge answer');
      throw new RequestError('pb_error', 'استجابة غير متوقعة من بنك المشاريع', 502);
    }
    if (isRecord(json) && typeof json.code === 'string') {
      const data = isRecord(json.data) ? json.data : {};
      const status = typeof data.status === 'number' && data.status >= 400 ? data.status : response.status >= 400 ? response.status : 400;
      // A plugin older than 39.0 has no bridge routes at all.
      if (json.code === 'rest_no_route') throw new RequestError('pb_not_supported', NOT_SUPPORTED, 501);
      if (json.code === 'forbidden' || json.code === 'unauthorized' || json.code === 'rest_forbidden') {
        this.options.log.error({ op, status }, 'Projects Bank rejected the bridge key');
        throw new RequestError('pb_config', 'إعداد الربط ببنك المشاريع غير صحيح، أبلغ الإدارة', 502);
      }
      throw new RequestError(json.code, typeof json.message === 'string' && json.message ? json.message : 'تعذّر تنفيذ الطلب', status);
    }
    // Never the body: the answer of `unlock` is the founder's contact data (rule 4), and logs are kept.
    this.options.log.error({ op, status: response.status, length: answer.length, json: answer.parsed }, 'unexpected Projects Bank bridge answer');
    throw new RequestError('pb_error', 'استجابة غير متوقعة من بنك المشاريع', 502);
  }

  ping(): Promise<{ version: string }> {
    return this.call('ping', {});
  }

  balance(member: PbMember): Promise<PbBalance> {
    return this.call('balance', { member });
  }

  async balances(members: PbMember[]): Promise<Record<string, PbBalanceLite>> {
    if (!members.length) return {};
    return (await this.call('balances', { members: members.slice(0, PB_BATCH) })).items;
  }

  unlock(member: PbMember, pid: number): Promise<PbUnlock> {
    return this.call('unlock', { member, pid });
  }

  grant(input: PbGrantInput): Promise<{ granted: number; left: number }> {
    // `member` is an extra beside the contract's fields: it lets the plugin file the grant under the right membership year.
    return this.call('grant', { contact_id: input.contactId, amount: input.amount, note: input.note, actor: input.actor, ...(input.member ? { member: input.member } : {}) });
  }

  unlocks(query: { page: number; perPage: number; contactId?: number }): Promise<{ total: number; items: PbUnlockRow[] }> {
    return this.call('unlocks', { page: query.page, per_page: query.perPage, ...(query.contactId ? { contact_id: query.contactId } : {}) });
  }
}

/** The live hub without a bridge key: every call says so, and the callers show it per section. */
export class OffPbBridge implements PbBridge {
  readonly mode = 'off' as const;

  private fail(): never {
    throw new RequestError('pb_not_configured', 'ربط بنك المشاريع غير مفعّل على الخادم بعد', 501);
  }

  async ping(): Promise<{ version: string }> {
    return this.fail();
  }
  async balance(): Promise<PbBalance> {
    return this.fail();
  }
  async balances(): Promise<Record<string, PbBalanceLite>> {
    return this.fail();
  }
  async unlock(): Promise<PbUnlock> {
    return this.fail();
  }
  async grant(): Promise<{ granted: number; left: number }> {
    return this.fail();
  }
  async unlocks(): Promise<{ total: number; items: PbUnlockRow[] }> {
    return this.fail();
  }
}

export const MOCK_PB_VERSION = '39.0-mock';
const MOCK_CREDITS = 5;

type MockRow = { contactId: number; pid: number; title: string; name: string; at: number };
type MockGrant = { contactId: number; amount: number; at: number };
type MockOptions = { projects: { get(id: number): PublicProject | null }; demo?: boolean };

/**
 * In-memory stand-in (never in production): the plugin's rules over its own unlock and grant rows. The founder
 * contact data it answers is invented. `demo` gives the seeded hub members a believable usage for the dashboard.
 */
export class MockPbBridge implements PbBridge {
  readonly mode = 'mock' as const;
  private readonly rows: MockRow[] = [];
  private readonly grants: MockGrant[] = [];
  private readonly demoSeen = new Set<number>();

  constructor(private readonly options: MockOptions) {}

  async ping(): Promise<{ version: string }> {
    return { version: MOCK_PB_VERSION };
  }

  private static periodStart(member: PbMember): number {
    const end = Date.parse(`${member.member_end}T00:00:00+03:00`);
    return Number.isNaN(end) || member.member_days <= 0 ? 0 : end - member.member_days * DAY_MS;
  }

  private static active(member: PbMember, now: number): boolean {
    // No end date = a member from the hub's pre-approval list, who never expires.
    if (!member.member_end) return member.member_days > 0;
    return Date.parse(`${member.member_end}T23:59:59+03:00`) >= now;
  }

  private demo(member: PbMember, now: number): void {
    if (!this.options.demo || this.demoSeen.has(member.contact_id)) return;
    this.demoSeen.add(member.contact_id);
    for (let index = 0; index < member.contact_id % 4; index += 1) {
      this.rows.push({ contactId: member.contact_id, pid: 900_000 + member.contact_id * 10 + index, title: `مشروع تجريبي ${index + 1}`, name: member.name, at: now - (index + 1) * 3 * DAY_MS });
    }
  }

  private lite(member: PbMember, now: number): PbBalanceLite {
    this.demo(member, now);
    const start = MockPbBridge.periodStart(member);
    const used = this.rows.filter((row) => row.contactId === member.contact_id && row.at >= start).length;
    const granted = this.grants.filter((grant) => grant.contactId === member.contact_id && grant.at >= start).reduce((sum, grant) => sum + grant.amount, 0);
    return { credits: MOCK_CREDITS, granted, used, left: Math.max(0, MOCK_CREDITS + granted - used) };
  }

  async balance(member: PbMember, now = Date.now()): Promise<PbBalance> {
    const start = MockPbBridge.periodStart(member);
    return { ...this.lite(member, now), period_start: start ? hubTime(start) : '', unlocked: this.rows.filter((row) => row.contactId === member.contact_id).map((row) => row.pid) };
  }

  async balances(members: PbMember[], now = Date.now()): Promise<Record<string, PbBalanceLite>> {
    return Object.fromEntries(members.slice(0, PB_BATCH).map((member) => [String(member.contact_id), this.lite(member, now)]));
  }

  async unlock(member: PbMember, pid: number, now = Date.now()): Promise<PbUnlock> {
    const project = this.options.projects.get(pid);
    if (!project) throw new RequestError('not_found', 'المشروع غير موجود', 404);
    if (!MockPbBridge.active(member, now)) throw new RequestError('not_member', 'هذه الميزة لأعضاء النادي المشتركين', 403);
    const contact: PbContact = {
      whatsapp: `+9665${String(10_000_000 + (pid % 89_999_999)).padStart(8, '0')}`,
      email: `founder${pid}@example.com`,
      website: `https://example.com/projects/${pid}`,
      pitch_url: project.hasPitchDeck && !project.isGolden ? `https://example.com/pitch/${pid}.pdf` : '',
    };
    const balance = this.lite(member, now);
    // Golden projects cost nothing and write no row.
    if (project.isGolden) return { already: false, left: balance.left, contact };
    if (this.rows.some((row) => row.contactId === member.contact_id && row.pid === pid)) return { already: true, left: balance.left, contact };
    if (balance.left <= 0) throw new RequestError('no_credit', 'انتهى رصيدك في بنك المشاريع لهذا العام', 402);
    this.rows.push({ contactId: member.contact_id, pid, title: project.title, name: member.name, at: now });
    return { already: false, left: balance.left - 1, contact };
  }

  async grant(input: PbGrantInput, now = Date.now()): Promise<{ granted: number; left: number }> {
    const member: PbMember = input.member ?? { contact_id: input.contactId, member_end: '', member_days: 0, name: '', email: '', phone: '' };
    const before = this.lite(member, now);
    // The allowance never drops below what the member already used.
    if (MOCK_CREDITS + before.granted + input.amount < before.used) throw new RequestError('below_used', 'لا يمكن خفض الرصيد إلى أقل مما استُخدم', 400);
    this.grants.push({ contactId: input.contactId, amount: input.amount, at: now });
    const after = this.lite(member, now);
    return { granted: after.granted, left: after.left };
  }

  async unlocks(query: { page: number; perPage: number; contactId?: number }): Promise<{ total: number; items: PbUnlockRow[] }> {
    const rows = this.rows.filter((row) => !query.contactId || row.contactId === query.contactId).sort((a, b) => b.at - a.at);
    const items = rows.slice((query.page - 1) * query.perPage, query.page * query.perPage).map((row) => ({ contact_id: row.contactId, pid: row.pid, title: row.title, name: row.name, unlocked_at: hubTime(row.at) }));
    return { total: rows.length, items };
  }
}
