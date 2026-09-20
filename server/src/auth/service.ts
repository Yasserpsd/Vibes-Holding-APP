import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Config } from '../config.js';
import type { HubClient, HubContact, HubResponse } from '../hub/types.js';
import type { Mailer } from '../mail/mailer.js';
import { maskEmail, OTP_RESEND_GAP_SECONDS, type AdminOtpStore } from './adminOtp.js';
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
/** The dashboard's password was right; the session starts after the e-mailed code (M18). */
export type OtpResult = { pending: false; otp: true; challengeToken: string; email: string; seconds: number; resendAfter: number };
export type AdminLoginResult = LoginResult | OtpResult;

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

type Deps = { hub: HubClient; sessions: SessionStore; config: Config; log: FastifyBaseLogger; otp?: AdminOtpStore; mailer?: Mailer };

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

  /** Dashboard sessions need the e-mailed code (M18). Off by default: the owner turns it on once the mail delay is known. */
  get adminOtpEnabled(): boolean {
    return this.deps.config.ADMIN_OTP === '1' && Boolean(this.deps.otp);
  }

  /** How the dashboard's second step stands, for /health: a code that cannot be mailed locks the dashboard, by design. */
  get adminOtpStatus(): 'off' | 'on' | 'no_mail' {
    if (!this.adminOtpEnabled) return 'off';
    return this.deps.mailer?.configured || this.deps.hub.mode === 'mock' ? 'on' : 'no_mail';
  }

  /** True while the session's e-mailed code is recent enough for the dashboard. */
  adminVerified(session: SessionRecord): boolean {
    if (!session.adminVerifiedAt) return false;
    return Date.now() - Date.parse(session.adminVerifiedAt) < this.deps.config.ADMIN_SESSION_HOURS * 3_600_000;
  }

  /** Dashboard sign-in: the hub checks the password and the admin role (rule 2); with ADMIN_OTP a code goes to the account's e-mail. */
  async adminLogin(login: string, password: string, ip: string): Promise<AdminLoginResult> {
    const uuid = newUuid();
    const result = await this.deps.hub.call('login', { uuid, ip, login, password, page_url: 'app://dashboard' });
    const contact = requireContact(result);
    if (result.pending) {
      const pendingToken = await this.deps.sessions.createPending(uuid, contact.email);
      return { pending: true, pendingToken, email: contact.email, mailSent: result.mail_sent === 1, text: result.text ?? '' };
    }
    if (contact.is_admin !== 1) {
      await this.dropVisitor(uuid);
      throw new AuthError('forbidden', 'هذه اللوحة لإدارة النادي فقط', 403);
    }
    const { otp } = this.deps;
    if (!this.adminOtpEnabled || !otp) return this.signIn(uuid, contact);
    if (this.adminOtpStatus === 'no_mail') {
      await this.dropVisitor(uuid);
      throw new AuthError('otp_mail_off', 'تعذر إرسال رمز الدخول: بريد الخادم غير مهيأ', 503);
    }
    const created = await otp.create(uuid, contact.id, contact.email, (email, code) => this.sendOtp(email, code)).catch(async (error: unknown) => {
      await this.dropVisitor(uuid);
      throw error;
    });
    if (!created.ok) {
      await this.dropVisitor(uuid);
      throw new AuthError('otp_cooldown', `محاولات دخول كثيرة لهذا الحساب، حاول بعد ${Math.ceil(created.waitSeconds / 60)} دقيقة`, 429);
    }
    return { pending: false, otp: true, challengeToken: created.token, email: maskEmail(contact.email), seconds: otp.seconds, resendAfter: OTP_RESEND_GAP_SECONDS };
  }

  async adminResend(challengeToken: string): Promise<{ seconds: number; resendAfter: number }> {
    const otp = this.requireOtp();
    const result = await otp.reissue(challengeToken, (email, code) => this.sendOtp(email, code));
    if (!result.ok) {
      if (result.reason === 'too_soon') throw new AuthError('otp_wait', `انتظر ${result.waitSeconds} ثانية ثم اطلب رمزًا جديدًا`, 429);
      if (result.reason === 'too_many') throw new AuthError('otp_resend_limit', 'تجاوزت عدد مرات إعادة الإرسال، ابدأ الدخول من جديد', 429);
      throw new AuthError('otp_expired', 'انتهت مهلة الدخول، ابدأ من جديد', 410);
    }
    return { seconds: otp.seconds, resendAfter: OTP_RESEND_GAP_SECONDS };
  }

  async adminVerify(challengeToken: string, code: string): Promise<SignedInResult> {
    const result = await this.requireOtp().check(challengeToken, code);
    if (!result.ok) {
      if (result.reason === 'bad_code') throw new AuthError('otp_bad_code', `الرمز غير صحيح، باقي ${result.attemptsLeft} محاولات`, 400);
      if (result.reason === 'code_expired') throw new AuthError('otp_code_expired', 'انتهت صلاحية الرمز، اضغط «إعادة الإرسال»', 400);
      if (result.reason === 'locked') throw new AuthError('otp_locked', 'محاولات خاطئة كثيرة، ابدأ الدخول من جديد', 429);
      throw new AuthError('otp_expired', 'انتهت مهلة الدخول، ابدأ من جديد', 410);
    }
    const { uuid } = result.challenge;
    // The role is read again: the hub may have changed it while the code was on its way.
    const account = await this.deps.hub.call('account', { uuid });
    const contact = account.contact;
    if (!contact || !contact.has_account || contact.is_admin !== 1) {
      await this.dropVisitor(uuid);
      throw new AuthError('forbidden', 'هذه اللوحة لإدارة النادي فقط', 403);
    }
    const token = await this.deps.sessions.createSession(uuid, contact.id, true);
    return { pending: false, token, me: this.remember(uuid, contact) };
  }

  async authenticate(token: string): Promise<SessionRecord | null> {
    return this.deps.sessions.getSession(token);
  }

  /** Drops the cached account of a contact (membership changed outside a session, for example a store purchase). */
  forget(contactId: number): void {
    for (const [uuid, entry] of this.meCache) {
      if (entry.me.id === contactId) this.meCache.delete(uuid);
    }
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

  private requireOtp(): AdminOtpStore {
    if (!this.adminOtpEnabled || !this.deps.otp) throw new AuthError('otp_off', 'رمز الدخول غير مفعّل', 404);
    return this.deps.otp;
  }

  /** The code travels in the mail body only: never in the subject, never in a log line. */
  private async sendOtp(email: string, code: string): Promise<void> {
    const { mailer, log } = this.deps;
    const seconds = this.deps.otp?.seconds ?? 60;
    try {
      await mailer?.send({
        to: [email],
        subject: 'رمز دخول لوحة إدارة نادي المستثمرين',
        text: [`رمز الدخول إلى لوحة الإدارة: ${code}`, `صالح لمدة ${seconds} ثانية ولمرة واحدة فقط.`, '', 'إذا لم تكن أنت من يحاول الدخول الآن فغيّر كلمة مرورك فورًا.'].join('\n'),
      });
    } catch (error) {
      log.error({ err: error instanceof Error ? error.message : 'unknown' }, 'dashboard sign-in code was not mailed');
      throw new AuthError('otp_mail_failed', 'تعذر إرسال رمز الدخول الآن، حاول بعد قليل', 503);
    }
  }

  private async dropVisitor(uuid: string): Promise<void> {
    try {
      await this.deps.hub.call('logout', { uuid });
    } catch {
      // Best effort: the visitor row is harmless without a session.
    }
  }

  private async gate(uuid: string, contact: HubContact): Promise<void> {
    if (!this.adminOnly || contact.is_admin === 1) return;
    await this.dropVisitor(uuid);
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
