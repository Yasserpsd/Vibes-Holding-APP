import type { FastifyBaseLogger } from 'fastify';

import { RequestError } from '../auth/guard.js';
import { RateLimiter } from '../auth/rateLimit.js';
import type { AuthService } from '../auth/service.js';
import type { SessionRecord } from '../auth/sessions.js';
import type { HubContact } from '../hub/types.js';
import type { PbBalanceLite, PbBridge, PbContact, PbMember } from './bridge.js';
import type { ProjectsService } from './service.js';

/**
 * A member's «رصيد» and unlocks in the Projects Bank, from inside the app (docs/BRIDGE_V2.md 4). The founder's contact
 * data and the pitch deck exist in an answer only when PB itself says this member unlocked this project (rule 4): they
 * come straight from PB's `unlock` answer for that member, are never cached and never stored here.
 */
export type AccessState = 'golden' | 'not_member' | 'can_unlock' | 'exhausted' | 'unlocked' | 'unavailable';
export type UnlockedContact = { whatsapp: string; email: string; website: string; pitchUrl: string };
export type ProjectAccess = { state: AccessState; isMember: boolean; balance: PbBalanceLite | null; contact: UnlockedContact | null; message: string | null };
export type UnlockResult = { ok: true; already: boolean; left: number; contact: UnlockedContact };

const UNLOCKS_PER_HOUR = 30;
const NOT_MEMBER = 'فتح بيانات التواصل متاح لأعضاء النادي المشتركين. فعّل عضويتك من شاشة العضوية.';

const clip = (value: string, max: number): string => value.trim().slice(0, max);
const link = (value: string): string => (/^https?:\/\//i.test(value.trim()) && URL.canParse(value.trim()) ? clip(value, 600) : '');

/** Only the four fields of the contract, each checked: whatever else PB answers stays on the server. */
function toContact(contact: PbContact): UnlockedContact {
  return { whatsapp: clip(contact.whatsapp, 40).replace(/[^\d+]/g, ''), email: /^[^\s@]+@[^\s@]+$/.test(contact.email.trim()) ? clip(contact.email, 190) : '', website: link(contact.website), pitchUrl: link(contact.pitch_url) };
}

export function pbMemberOf(contact: HubContact): PbMember {
  return { contact_id: contact.id, member_end: contact.member_end, member_days: contact.member_days, name: contact.name, email: contact.email, phone: contact.phone };
}

type Deps = { pb: PbBridge; projects: ProjectsService; auth: AuthService; log: FastifyBaseLogger; /** The dashboard shows the same balance: it drops its copy. */ onUnlock?: () => void };

export class ProjectAccessService {
  private readonly limiter = new RateLimiter();

  constructor(private readonly deps: Deps) {}

  private project(id: number) {
    const project = this.deps.projects.get(id);
    if (!project) throw new RequestError('not_found', 'المشروع غير موجود', 404);
    return project;
  }

  async access(session: SessionRecord, id: number): Promise<ProjectAccess> {
    const project = this.project(id);
    const contact = await this.deps.auth.contact(session);
    const isMember = contact.is_member === 1;
    // Golden projects cost nothing: their partnership page is public in the project itself.
    if (project.isGolden) return { state: 'golden', isMember, balance: null, contact: null, message: null };
    if (!isMember) return { state: 'not_member', isMember, balance: null, contact: null, message: NOT_MEMBER };
    try {
      const member = pbMemberOf(contact);
      const { credits, granted, used, left, unlocked } = await this.deps.pb.balance(member);
      const balance = { credits, granted, used, left };
      if (!unlocked.includes(id)) return { state: left > 0 ? 'can_unlock' : 'exhausted', isMember, balance, contact: null, message: null };
      // Already his: PB answers `already` with the contact data and takes nothing.
      const opened = await this.deps.pb.unlock(member, id);
      return { state: 'unlocked', isMember, balance: { ...balance, left: opened.left }, contact: toContact(opened.contact), message: null };
    } catch (error) {
      if (!(error instanceof RequestError) || error.status < 500) throw error;
      // The bridge is down or not set up: the project page still opens, without the unlock button.
      this.deps.log.warn({ code: error.code }, 'Projects Bank access unavailable');
      return { state: 'unavailable', isMember, balance: null, contact: null, message: error.message };
    }
  }

  async unlock(session: SessionRecord, id: number): Promise<UnlockResult> {
    const project = this.project(id);
    if (project.isGolden) throw new RequestError('golden', 'المشاريع الذهبية لا تحتاج إلى فتح: صفحة الشراكة متاحة للجميع', 409);
    const contact = await this.deps.auth.contact(session);
    if (contact.is_member !== 1) throw new RequestError('not_member', NOT_MEMBER, 403);
    if (!this.limiter.hit(`unlock:${contact.id}`, UNLOCKS_PER_HOUR, 3_600_000)) throw new RequestError('rate', 'محاولات كثيرة في وقت قصير، حاول بعد قليل', 429);
    const opened = await this.deps.pb.unlock(pbMemberOf(contact), id);
    if (!opened.already) this.deps.onUnlock?.();
    return { ok: true, already: opened.already, left: opened.left, contact: toContact(opened.contact) };
  }
}
