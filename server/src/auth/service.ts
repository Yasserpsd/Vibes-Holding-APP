import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Config } from '../config.js';
import type { HubClient, HubContact, HubResponse } from '../hub/types.js';
import type { SessionRecord, SessionStore } from './sessions.js';

export type Persona = 'entrepreneur' | 'investor' | 'neutral';

export const PERSONAS: { key: Persona; label: string }[] = [
  { key: 'entrepreneur', label: 'رائد أعمال — لدي مشروع مميز' },
  { key: 'investor', label: 'مستثمر — أبحث عن فرص شراكة واعدة' },
  { key: 'neutral', label: 'محايد — شريك المستقبل وسأحدد توجهي لاحقًا' },
];

export type MembershipStatus = 'unactivated' | 'active' | 'expired';

export type Membership = {
  status: MembershipStatus;
  daysLeft: number | null;
  endDate: string | null;
  aiDailyLimit: number;
  aiDailyLeft: number | null;
};

/** The account as the app sees it. Built from the hub contact; never stored on the server. */
export type Me = {
  id: number;
  name: string;
  email: string;
  phone: string;
  persona: Persona | '';
  personaLabel: string;
  bio: string;
  jobTitle: string;
  company: string;
  city: string;
  website: string;
  social: string;
  avatarUrl: string;
  verified: boolean;
  isAdmin: boolean;
  membership: Membership;
};

export type RegisterInput = {
  name: string;
  country: string;
  phone: string;
  email: string;
  password: string;
  persona: Persona;
  bio: string;
  jobTitle?: string;
};

export type ProfilePatch = Partial<Pick<Me, 'name' | 'jobTitle' | 'company' | 'city' | 'website' | 'bio' | 'social'>> & {
  password?: string;
};

export type PendingResult = { pending: true; pendingToken: string; email: string; mailSent: boolean; text: string };
export type SignedInResult = { pending: false; token: string; me: Me };
export type LoginResult = PendingResult | SignedInResult;

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

const ME_CACHE_MS = 60_000;

function membershipOf(contact: HubContact): Membership {
  const status: MembershipStatus = contact.is_member ? 'active' : contact.member_expired ? 'expired' : 'unactivated';
  return {
    status,
    daysLeft: status === 'active' ? contact.member_left : null,
    endDate: contact.member_end ? contact.member_end : null,
    aiDailyLimit: contact.daily_limit,
    aiDailyLeft: contact.daily_left,
  };
}

export function toMe(contact: HubContact): Me {
  const persona = PERSONAS.find((item) => item.key === contact.persona);
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    persona: persona?.key ?? '',
    personaLabel: persona?.label ?? '',
    bio: contact.bio,
    jobTitle: contact.job_title,
    company: contact.company,
    city: contact.city,
    website: contact.website,
    social: contact.social,
    avatarUrl: contact.avatar,
    verified: contact.verified === 1,
    isAdmin: contact.is_admin === 1,
    membership: membershipOf(contact),
  };
}

type Deps = { hub: HubClient; sessions: SessionStore; config: Config; log: FastifyBaseLogger };

export class AuthService {
  private readonly meCache = new Map<string, { me: Me; at: number }>();

  constructor(private readonly deps: Deps) {}

  /** Registrations on the live hub stay closed in the test environment unless the owner opens them. */
  get registrationOpen(): boolean {
    const { config } = this.deps;
    return config.HUB_MODE === 'mock' || config.APP_ENV === 'production' || config.HUB_ALLOW_TEST_REGISTRATION === '1';
  }

  /** Preview builds sign in hub admins only (CLAUDE.md rule 9). */
  get adminOnly(): boolean {
    return this.deps.config.APP_ENV !== 'production';
  }

  async register(input: RegisterInput, ip: string): Promise<PendingResult> {
    if (!this.registrationOpen) {
      throw new AuthError('registration_closed', 'التسجيل غير متاح في النسخة التجريبية حاليًا. سجّل الدخول بحساب الإدارة.', 403);
    }
    const uuid = newUuid();
    const result = await this.deps.hub.call('register', {
      uuid,
      ip,
      name: input.name,
      country: input.country,
      phone: input.phone,
      email: input.email,
      password: input.password,
      persona: input.persona,
      bio: input.bio,
      job_title: input.jobTitle ?? '',
      page_url: 'app://register',
    });
    const email = result.contact?.email || input.email;
    const pendingToken = await this.deps.sessions.createPending(uuid, email);
    return { pending: true, pendingToken, email, mailSent: result.mail_sent === 1, text: result.text ?? '' };
  }

  async resend(pendingToken: string, ip: string): Promise<{ mailSent: boolean; text: string }> {
    const pending = await this.requirePending(pendingToken);
    const result = await this.deps.hub.call('resend_code', { uuid: pending.uuid, ip });
    return { mailSent: result.mail_sent === 1, text: result.text ?? '' };
  }

  async verify(pendingToken: string, code: string, ip: string): Promise<SignedInResult> {
    const pending = await this.requirePending(pendingToken);
    const result = await this.deps.hub.call('verify', { uuid: pending.uuid, code, ip, page_url: 'app://verify' });
    const contact = requireContact(result);
    await this.gate(pending.uuid, contact);
    await this.deps.sessions.deletePending(pendingToken);
    return this.signIn(pending.uuid, contact);
  }

  async login(login: string, password: string, ip: string): Promise<LoginResult> {
    const uuid = newUuid();
    const result = await this.deps.hub.call('login', { uuid, ip, login, password, page_url: 'app://login' });
    const contact = requireContact(result);
    if (result.pending) {
      const pendingToken = await this.deps.sessions.createPending(uuid, contact.email);
      return { pending: true, pendingToken, email: contact.email, mailSent: result.mail_sent === 1, text: result.text ?? '' };
    }
    await this.gate(uuid, contact);
    return this.signIn(uuid, contact);
  }

  async authenticate(token: string): Promise<SessionRecord | null> {
    return this.deps.sessions.getSession(token);
  }

  async me(session: SessionRecord, fresh = false): Promise<Me> {
    const cached = this.meCache.get(session.uuid);
    if (!fresh && cached && Date.now() - cached.at < ME_CACHE_MS) return cached.me;
    const result = await this.deps.hub.call('account', { uuid: session.uuid });
    if (!result.contact || !result.contact.has_account) {
      throw new AuthError('session_expired', 'انتهت الجلسة، سجّل الدخول من جديد', 401);
    }
    return this.remember(session.uuid, result.contact);
  }

  async updateProfile(session: SessionRecord, patch: ProfilePatch): Promise<Me> {
    const body: Record<string, unknown> = { uuid: session.uuid };
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.jobTitle !== undefined) body.job_title = patch.jobTitle;
    if (patch.company !== undefined) body.company = patch.company;
    if (patch.city !== undefined) body.city = patch.city;
    if (patch.website !== undefined) body.website = patch.website;
    if (patch.bio !== undefined) body.bio = patch.bio;
    if (patch.social !== undefined) body.social = patch.social;
    if (patch.password) body.password = patch.password;
    const result = await this.deps.hub.call('profile', body);
    return this.remember(session.uuid, requireContact(result));
  }

  async logout(token: string, session: SessionRecord): Promise<void> {
    this.meCache.delete(session.uuid);
    await this.deps.sessions.deleteSession(token);
    try {
      await this.deps.hub.call('logout', { uuid: session.uuid });
    } catch (error) {
      this.deps.log.warn({ err: error }, 'hub logout failed; the app session is already gone');
    }
  }

  async requestReset(login: string, ip: string): Promise<void> {
    await this.deps.hub.call('reset_request', { login, ip });
  }

  async confirmReset(login: string, code: string, password: string, ip: string): Promise<void> {
    await this.deps.hub.call('reset_confirm', { login, code, password, ip });
  }

  async deleteAccount(token: string, session: SessionRecord, password: string): Promise<void> {
    await this.deps.hub.call('delete_account', { uuid: session.uuid, password });
    this.meCache.delete(session.uuid);
    await this.deps.sessions.deleteSession(token);
  }

  private async requirePending(pendingToken: string) {
    const pending = await this.deps.sessions.getPending(pendingToken);
    if (!pending) throw new AuthError('pending_expired', 'انتهت مهلة التحقق، ابدأ من جديد', 410);
    return pending;
  }

  private async gate(uuid: string, contact: HubContact): Promise<void> {
    if (!this.adminOnly || contact.is_admin === 1) return;
    try {
      await this.deps.hub.call('logout', { uuid });
    } catch {
      // Best effort: the visitor row is harmless without a session.
    }
    throw new AuthError('admin_only', 'النسخة التجريبية متاحة لحسابات إدارة النادي فقط', 403);
  }

  private async signIn(uuid: string, contact: HubContact): Promise<SignedInResult> {
    const token = await this.deps.sessions.createSession(uuid, contact.id);
    return { pending: false, token, me: this.remember(uuid, contact) };
  }

  private remember(uuid: string, contact: HubContact): Me {
    const me = toMe(contact);
    this.meCache.set(uuid, { me, at: Date.now() });
    if (this.meCache.size > 5_000) this.meCache.clear();
    return me;
  }
}

function newUuid(): string {
  return `app-${randomUUID()}`;
}

function requireContact(result: HubResponse): HubContact {
  if (!result.contact) throw new AuthError('hub_error', 'استجابة غير مكتملة من النادي', 502);
  return result.contact;
}
