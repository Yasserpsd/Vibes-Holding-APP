import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Config } from '../config.js';
import { normLogin } from '../hub/phone.js';
import { HubError, type HubClient, type HubContact, type HubResponse } from '../hub/types.js';
import { interestLabel, isInterestKey } from '../interests/types.js';
import type { AppLang, AppSource } from '../lang.js';
import type { SocialIdentity } from './social.js';
import { nameProblem, nameRuleIssue, type NameJudge } from './name.js';
import type { InvitesService } from '../invites/service.js';
import type { Mailer } from '../mail/mailer.js';
import { maskEmail, OTP_RESEND_GAP_SECONDS, type AdminOtpStore } from './adminOtp.js';
import { otpauthUri, TOTP_TOKEN_SECONDS, type TotpStatus, type TotpStore } from './totp.js';
import type { SessionRecord, SessionStore } from './sessions.js';

export type Persona = 'neutral' | 'entrepreneur' | 'investor';

export const PERSONAS: { key: Persona; label: string; labelEn: string }[] = [
  // The owner's wording and order (2026-09-21), the same three lines as the home portals.
  // M122: `labelEn` for the English member mails and pushes (the app shows its own strings).
  { key: 'neutral', label: 'محايد — أستكشف توجهي', labelEn: 'Neutral — exploring my direction' },
  { key: 'entrepreneur', label: 'رائد أعمال — لدي مشروع', labelEn: 'Entrepreneur — I have a project' },
  { key: 'investor', label: 'مستثمر — أبحث عن فرص', labelEn: 'Investor — looking for opportunities' },
];

export type MembershipStatus = 'unactivated' | 'active' | 'expired';

/**
 * M30: the membership number printed on the card — one letter for the category (N محايد,
 * E رائد الأعمال, I مستثمر, C when no category is set) and ten digits from the hub contact id,
 * so the number is unique, never stored, and the same wherever it is computed.
 */
const CARD_LETTERS: Record<string, string> = { neutral: 'N', entrepreneur: 'E', investor: 'I' };

export function membershipNumber(account: { id: number; persona: string }): string {
  return `${CARD_LETTERS[account.persona] ?? 'C'}-${String(account.id).padStart(10, '0').slice(-10)}`;
}

export type Membership = {
  status: MembershipStatus;
  daysLeft: number | null;
  endDate: string | null;
  aiDailyLimit: number;
  aiDailyLeft: number | null;
};

/** M109e: the member's data as the ENGLISH app displays it (name transliterated); never stored at the hub. */
export type MeEnglish = { name: string; jobTitle: string; company: string; city: string; bio: string };

/** The account as the app sees it. Built from the hub contact; never stored on the server. */
export type Me = {
  id: number;
  name: string;
  email: string;
  /**
   * M156: the address the member wants mail at when the account's own e-mail is an Apple «Hide My Email»
   * relay (hub 2.26.0 stores it; '' on older hubs or when never asked). Every member mail prefers it.
   */
  contactEmail: string;
  /** M156: true when `email` is an Apple private relay — the app asks for a real address then. */
  emailRelay: boolean;
  phone: string;
  persona: Persona | '';
  personaLabel: string;
  bio: string;
  jobTitle: string;
  company: string;
  /** M69: «فرد / شركة» chosen at registration; '' on accounts older than hub 2.18.0 (treated as فرد). */
  memberType: 'individual' | 'company' | '';
  city: string;
  website: string;
  social: string;
  avatarUrl: string;
  verified: boolean;
  isAdmin: boolean;
  isModerator: boolean;
  membership: Membership;
  /** M30: the number on the membership card, derived from the category and the contact id. */
  cardNumber: string;
  /** M109e: filled per-request when the app asks in English; absent otherwise (display only). */
  en?: MeEnglish | null;
  /**
   * M147 «أكمل ملفك»: what the sign-in gate still needs before the app opens — a Google/Apple-born
   * account lands with name + e-mail only. Empty = complete. Interests count only when the hub
   * reports them (2.21.3+), so an older hub never blocks a member for a field it cannot show.
   */
  profileMissing: ProfileMissing[];
};

export type ProfileMissing = 'name' | 'memberType' | 'phone' | 'persona' | 'bio' | 'jobTitle' | 'interests' | 'company' | 'contactEmail';

/** Apple «Hide My Email» addresses forward to the real inbox but hide it from us. */
export function isRelayEmail(email: string): boolean {
  return /@privaterelay\.appleid\.com$/i.test(String(email ?? '').trim());
}

/** The address a member's mail goes to: the real one he gave us over an Apple relay, else the account's. */
export function mailAddressOf(contact: { email: string; contact_email?: string }): string {
  const real = String(contact.contact_email ?? '').trim();
  return real || String(contact.email ?? '').trim();
}

export function profileMissingOf(contact: HubContact): ProfileMissing[] {
  const missing: ProfileMissing[] = [];
  // M156 (owner): a kunya or a made-up name meets the gate too — the member writes a real first + family name.
  if (nameRuleIssue(String(contact.name ?? ''))) missing.push('name');
  // Owner (2026-10-28): «فرد / شركة» is the first question — a social-born account never answered it.
  if (contact.member_type !== 'individual' && contact.member_type !== 'company') missing.push('memberType');
  if (!String(contact.phone ?? '').trim()) missing.push('phone');
  if (!PERSONAS.some((item) => item.key === contact.persona)) missing.push('persona');
  if (String(contact.bio ?? '').trim().length < 10) missing.push('bio');
  // M156 (owner, 2026-10-29: «مفيش حد يقدر يفتح التطبيق غير لما يكمل كل بياناته»): the job joins the rule.
  if (!String(contact.job_title ?? '').trim()) missing.push('jobTitle');
  if (contact.interests !== undefined && !String(contact.interests).trim()) missing.push('interests');
  if (contact.member_type === 'company' && !String(contact.company ?? '').trim()) missing.push('company');
  // M156: an Apple-relay account must give a real address (only when the hub can store it, 2.26.0+).
  if (contact.contact_email !== undefined && isRelayEmail(contact.email) && !String(contact.contact_email).trim()) missing.push('contactEmail');
  return missing;
}

export type RegisterInput = {
  name: string;
  /** M69: «فرد / شركة» — a company registration carries the company name. */
  memberType: 'individual' | 'company';
  companyName?: string;
  country: string;
  phone: string;
  email: string;
  password: string;
  persona: Persona;
  bio: string;
  jobTitle?: string;
  /** M32: another member's membership number — resolved and stored by the hub, never by the client. */
  inviteCode?: string;
  /** M120: interest keys from the registration screen (plus the «أخرى» text), for the hub's admin mail. */
  interests?: string[];
  interestsOther?: string;
};

export type ProfilePatch = Partial<Pick<Me, 'name' | 'jobTitle' | 'company' | 'city' | 'website' | 'bio' | 'social'>> & {
  password?: string;
  /** M74: the in-app category switch (the hub stores the persona; one identity source). */
  persona?: Persona;
  /** M147: the completion gate fills the phone (with its country) and the interests (keys → Arabic labels for the hub). */
  memberType?: 'individual' | 'company';
  phone?: string;
  country?: string;
  interests?: string[];
  interestsOther?: string;
  /** M156: the real address of an Apple-relay account (hub 2.26.0 `contact_email`). */
  contactEmail?: string;
};

export type PendingResult = { pending: true; pendingToken: string; email: string; mailSent: boolean; text: string };
export type SignedInResult = { pending: false; token: string; me: Me; /** M157: true when this social sign-in created the account (hub `created`). */ created?: boolean };
export type LoginResult = PendingResult | SignedInResult;
/** The dashboard's password was right; the session starts after the e-mailed code (M18). */
export type OtpResult = { pending: false; otp: true; challengeToken: string; email: string; seconds: number; resendAfter: number };
/** M140: the account has an authenticator app; the session starts after its 6-digit code (or a backup code). */
export type TotpStepResult = { pending: false; totp: true; stepToken: string; seconds: number };
/** M140: a dashboard account without an authenticator yet (ADMIN_TOTP=1) enrols one before its first session. */
export type TotpSetupResult = { pending: false; totpSetup: true; setupToken: string; secret: string; uri: string; seconds: number };
export type MemberLoginResult = LoginResult | TotpStepResult;
export type AdminLoginResult = LoginResult | OtpResult | TotpStepResult | TotpSetupResult;
/** The first dashboard sign-in after enrolment: the session plus the backup codes, shown once. */
export type EnrolledResult = SignedInResult & { backupCodes: string[] };

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
/** M165: how long a cached account is still answered (with a background refresh) before the hub must be waited for. */
const ME_STALE_MAX_MS = 24 * 60 * 60_000;
/** M165: the hub `account` call gets less than the app's own 15-second patience. */
const ME_HUB_TIMEOUT_MS = 10_000;

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
    contactEmail: String(contact.contact_email ?? '').trim(),
    emailRelay: isRelayEmail(contact.email),
    phone: contact.phone,
    persona: persona?.key ?? '',
    personaLabel: persona?.label ?? '',
    bio: contact.bio,
    jobTitle: contact.job_title,
    company: contact.company,
    memberType: contact.member_type ?? '',
    city: contact.city,
    website: contact.website,
    social: contact.social,
    avatarUrl: contact.avatar,
    verified: contact.verified === 1,
    isAdmin: contact.is_admin === 1,
    isModerator: contact.role === 'publisher',
    membership: membershipOf(contact),
    cardNumber: membershipNumber({ id: contact.id, persona: persona?.key ?? '' }),
    profileMissing: profileMissingOf(contact),
  };
}

type Deps = { hub: HubClient; sessions: SessionStore; config: Config; log: FastifyBaseLogger; otp?: AdminOtpStore; mailer?: Mailer; invites?: InvitesService; totp?: TotpStore; nameJudge?: NameJudge | null };

export class AuthService {
  private readonly meCache = new Map<string, { me: Me; at: number }>();
  /** M165: accounts whose stale copy is being refreshed from the hub right now. */
  private readonly revalidating = new Set<string>();

  constructor(private readonly deps: Deps) {}

  /** Registrations on the live hub stay closed in the test environment unless the owner opens them. */
  get registrationOpen(): boolean {
    const { config } = this.deps;
    return config.HUB_MODE === 'mock' || config.APP_ENV === 'production' || config.HUB_ALLOW_TEST_REGISTRATION === '1';
  }

  /** M79-launch (owner, 2026-10-17): the preview is open for everyone to try the personas; AUTH_ADMIN_ONLY=1 restores the old rule-9 gate. */
  get adminOnly(): boolean {
    return this.deps.config.APP_ENV !== 'production' && this.deps.config.AUTH_ADMIN_ONLY === '1';
  }

  async register(input: RegisterInput, ip: string, lang: AppLang = 'ar', source: AppSource = 'app'): Promise<PendingResult> {
    if (!this.registrationOpen) {
      throw new AuthError('registration_closed', 'التسجيل غير متاح في النسخة التجريبية حاليًا. سجّل الدخول بحساب الإدارة.', 403);
    }
    // M156 (owner): a real first + family name or no account — rules, then the model when configured.
    const badName = await nameProblem(input.name, lang, this.deps.nameJudge);
    if (badName) throw new AuthError('bad_name', badName, 400);
    // M32: the invite code is shaped-checked here, then the hub itself resolves and stores it (rule 5's spirit: never the client's word).
    const referral = input.inviteCode?.trim() && this.deps.invites ? await this.deps.invites.prepare(input.inviteCode) : '';
    // M120 (owner): the picked interests travel as Arabic labels so the hub's «عضو جديد» mail reads at a glance.
    const interests = (input.interests ?? [])
      .filter(isInterestKey)
      .map((key) => (key === 'other' && input.interestsOther?.trim() ? `أخرى: ${input.interestsOther.trim()}` : interestLabel(key)))
      .join('، ');
    const uuid = newUuid();
    const result = await this.deps.hub.call('register', {
      uuid,
      ip,
      name: input.name,
      member_type: input.memberType,
      company_name: input.memberType === 'company' ? (input.companyName ?? '') : '',
      country: input.country,
      phone: input.phone,
      email: input.email,
      password: input.password,
      persona: input.persona,
      bio: input.bio,
      job_title: input.jobTitle ?? '',
      // M122: the hub stores the registration language (contacts.lang, hub 2.20.0) and every
      // member mail it sends — activation code, welcome, receipts — follows it.
      lang,
      page_url: 'app://register',
      // M146: the hub stores it and the admin «عضو جديد» mail shows iPhone / Android (hub 2.21.1+; older hubs ignore it).
      source,
      ...(referral ? { referral } : {}),
      ...(interests ? { interests } : {}),
    });
    if (referral && this.deps.invites && result.contact) {
      await this.deps.invites.recordFromRegister(result.contact, Number(result.referred_by ?? 0), String(result.referred_name ?? ''), referral);
    }
    const email = result.contact?.email || input.email;
    const pendingToken = await this.deps.sessions.createPending(uuid, email);
    return { pending: true, pendingToken, email, mailSent: result.mail_sent === 1, text: result.text ?? '' };
  }

  async resend(pendingToken: string, ip: string): Promise<{ mailSent: boolean; text: string }> {
    const pending = await this.requirePending(pendingToken);
    const result = await this.deps.hub.call('resend_code', { uuid: pending.uuid, ip });
    return { mailSent: result.mail_sent === 1, text: result.text ?? '' };
  }

  async verify(pendingToken: string, code: string, ip: string): Promise<MemberLoginResult> {
    const pending = await this.requirePending(pendingToken);
    const result = await this.deps.hub.call('verify', { uuid: pending.uuid, code, ip, page_url: 'app://verify' });
    const contact = requireContact(result);
    // M32: a confirmed e-mail makes the invitation real — recorded before the sign-in gate, and it never throws.
    if (this.deps.invites) await this.deps.invites.onVerified(contact);
    await this.gate(pending.uuid, contact);
    await this.deps.sessions.deletePending(pendingToken);
    return this.signIn(pending.uuid, contact);
  }

  async login(login: string, password: string, ip: string, country?: string): Promise<MemberLoginResult> {
    const uuid = newUuid();
    // The login field takes a phone from ANY country (the app sends the picked country code);
    // normalised here because the hub's own vai_norm_phone only understands Saudi local forms.
    const normalized = normLogin(login, country);
    let result: HubResponse;
    try {
      result = await this.deps.hub.call('login', { uuid, ip, login: normalized, password, page_url: 'app://login' });
    } catch (cause) {
      // M128 (owner): a sign-in with NO account behind it gets its own answer («حسابك غير مسجل»),
      // so the app carries the person straight to registration instead of a wrong-password message.
      if (cause instanceof HubError && (cause.status === 401 || cause.status === 404) && !(await this.accountExists(normalized))) {
        throw new AuthError('no_account', 'لا يوجد حساب مسجل بهذه البيانات — أنشئ حسابك الجديد أولًا', 404);
      }
      throw cause;
    }
    const contact = requireContact(result);
    if (result.pending) {
      const pendingToken = await this.deps.sessions.createPending(uuid, contact.email);
      return { pending: true, pendingToken, email: contact.email, mailSent: result.mail_sent === 1, text: result.text ?? '' };
    }
    await this.gate(uuid, contact);
    return this.signIn(uuid, contact);
  }

  /**
   * M128: true when the hub knows this e-mail or phone (member_status looks the contact up without
   * a session). Any doubt — odd input, a hub hiccup, an old hub — answers true, so the regular
   * wrong-password message stands and nobody is bounced to registration by mistake.
   */
  private async accountExists(login: string): Promise<boolean> {
    const body = login.includes('@') ? { email: login } : /^\d{8,15}$/.test(login) ? { phone: login } : null;
    if (!body) return true;
    try {
      const result = await this.deps.hub.call('member_status', body);
      return result.found !== false;
    } catch {
      return true;
    }
  }

  /**
   * M46: sign-in with a Google / Apple identity the server itself verified (social.ts). The hub
   * finds or creates the contact by the verified e-mail (rule 2 — one identity source), already
   * verified, so there is no code step; the same test-environment gates as password login apply.
   */
  async socialLogin(identity: SocialIdentity, ip: string, lang: AppLang = 'ar', source: AppSource = 'app'): Promise<MemberLoginResult> {
    if (!identity.emailVerified) {
      throw new AuthError('social_email', 'بريد هذا الحساب غير موثّق لدى المزوّد — سجّل بالبريد وكلمة المرور', 403);
    }
    const uuid = newUuid();
    let result: HubResponse;
    try {
      result = await this.deps.hub.call('social_login', {
        uuid,
        ip,
        source,
        provider: identity.provider,
        sub: identity.sub,
        email: identity.email,
        email_verified: 1,
        name: identity.name,
        allow_create: this.registrationOpen ? 1 : 0,
        // M122: a first-time social registration stores the app's language at the hub (2.20.0).
        lang,
        page_url: 'app://social',
      });
    } catch (error) {
      if (error instanceof HubError && error.code === 'hub_not_supported') {
        // The hub plugin is older than 2.8.0: say so instead of a generic failure.
        throw new AuthError('social_unsupported', 'الدخول بحساب جوجل أو أبل غير متاح حاليًا — سجّل بالبريد وكلمة المرور', 503);
      }
      throw error;
    }
    const contact = requireContact(result);
    await this.gate(uuid, contact);
    // M157: tell the app when the hub created the account (first social sign-in), so it logs the registration event for ads attribution.
    const created = result.created === 1 || result.created === '1' || result.created === true;
    const signed = await this.signIn(uuid, contact);
    return created && 'token' in signed ? { ...signed, created: true } : signed;
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
    const result = await this.deps.hub.call('login', { uuid, ip, login: normLogin(login), password, page_url: 'app://dashboard' });
    const contact = requireContact(result);
    if (result.pending) {
      const pendingToken = await this.deps.sessions.createPending(uuid, contact.email);
      return { pending: true, pendingToken, email: contact.email, mailSent: result.mail_sent === 1, text: result.text ?? '' };
    }
    // M28: the dashboard admits admins and moderators (hub role `publisher`); sections are gated per level.
    if (contact.is_admin !== 1 && contact.role !== 'publisher') {
      await this.dropVisitor(uuid);
      throw new AuthError('forbidden', 'هذه اللوحة لإدارة النادي فقط', 403);
    }
    const { otp } = this.deps;
    if (!this.adminOtpEnabled || !otp) return this.adminSecondFactor(uuid, contact, false);
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

  async adminVerify(challengeToken: string, code: string): Promise<SignedInResult | TotpStepResult | TotpSetupResult> {
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
    if (!contact || !contact.has_account || (contact.is_admin !== 1 && contact.role !== 'publisher')) {
      await this.dropVisitor(uuid);
      throw new AuthError('forbidden', 'هذه اللوحة لإدارة النادي فقط', 403);
    }
    return this.adminSecondFactor(uuid, contact, true);
  }

  // ---- M140: authenticator app (TOTP) — mandatory for the dashboard with ADMIN_TOTP=1, optional for members.

  get adminTotpEnabled(): boolean {
    return this.deps.config.ADMIN_TOTP === '1' && Boolean(this.deps.totp);
  }

  /** After the password (and the e-mailed code): the authenticator code of an enrolled account, or the enrolment of a new one. */
  private async adminSecondFactor(uuid: string, contact: HubContact, viaOtp: boolean): Promise<SignedInResult | TotpStepResult | TotpSetupResult> {
    const { totp } = this.deps;
    if (!this.adminTotpEnabled || !totp) return this.issueSession(uuid, contact, viaOtp, false);
    if (await totp.enabled(contact.id)) {
      const stepToken = await totp.beginStep(contact.id, uuid, 'dashboard', viaOtp);
      return { pending: false, totp: true, stepToken, seconds: TOTP_TOKEN_SECONDS };
    }
    const setup = await totp.beginSetup(contact.id, uuid, 'dashboard', viaOtp);
    return { pending: false, totpSetup: true, setupToken: setup.token, secret: setup.secret, uri: otpauthUri(contact.email, setup.secret), seconds: TOTP_TOKEN_SECONDS };
  }

  /** Dashboard: the authenticator code (or a backup code) of an enrolled account ends the sign-in. */
  async adminTotpVerify(stepToken: string, code: string): Promise<SignedInResult> {
    const result = await this.requireTotp().checkStep(stepToken, code);
    if (!result.ok) throw totpFailure(result.reason);
    if (result.audience !== 'dashboard') throw new AuthError('totp_expired', 'انتهت مهلة الدخول، ابدأ من جديد', 410);
    const contact = await this.dashboardContact(result.uuid);
    return this.issueSession(result.uuid, contact, result.adminVerified, true);
  }

  /** Dashboard: the first code of a fresh enrolment proves the app holds the secret; the session starts and the backup codes show once. */
  async adminTotpEnroll(setupToken: string, code: string): Promise<EnrolledResult> {
    const result = await this.requireTotp().completeSetup(setupToken, code);
    if (!result.ok) throw totpFailure(result.reason);
    if (result.audience !== 'dashboard' || !result.uuid) throw new AuthError('totp_expired', 'انتهت مهلة الدخول، ابدأ من جديد', 410);
    const contact = await this.dashboardContact(result.uuid);
    this.notifyTotp(contact.email, 'enabled');
    const signedIn = await this.issueSession(result.uuid, contact, result.adminVerified, true);
    return { ...signedIn, backupCodes: result.backupCodes };
  }

  /** App: the authenticator code of a member who switched the extra protection on ends the sign-in. */
  async totpLogin(stepToken: string, code: string): Promise<SignedInResult> {
    const result = await this.requireTotp().checkStep(stepToken, code);
    if (!result.ok) throw totpFailure(result.reason);
    const account = await this.deps.hub.call('account', { uuid: result.uuid });
    const contact = account.contact;
    if (!contact || !contact.has_account) {
      await this.dropVisitor(result.uuid);
      throw new AuthError('totp_expired', 'انتهت مهلة الدخول، ابدأ من جديد', 410);
    }
    return this.issueSession(result.uuid, contact, false, true);
  }

  async totpStatus(contactId: number): Promise<TotpStatus> {
    return this.requireTotp().status(contactId);
  }

  /** Account: start (or re-link, which needs a current code) the authenticator; nothing changes until the first code confirms. */
  async totpSetup(session: SessionRecord, code: string | undefined): Promise<{ setupToken: string; secret: string; uri: string; seconds: number }> {
    const totp = this.requireTotp();
    const me = await this.me(session);
    if (await totp.enabled(me.id)) {
      if (!code) throw new AuthError('totp_code_needed', 'أدخل رمز تطبيق المصادقة الحالي أولًا', 400);
      const verified = await totp.verify(me.id, code);
      if (!verified.ok) throw new AuthError('totp_bad_code', 'الرمز غير صحيح', 400);
    }
    const setup = await totp.beginSetup(me.id, null, 'app', false);
    return { setupToken: setup.token, secret: setup.secret, uri: otpauthUri(me.email, setup.secret), seconds: TOTP_TOKEN_SECONDS };
  }

  /** Account: the first code goes live; the backup codes are shown once. */
  async totpConfirm(session: SessionRecord, setupToken: string, code: string): Promise<{ backupCodes: string[] }> {
    const result = await this.requireTotp().completeSetup(setupToken, code);
    if (!result.ok) throw totpFailure(result.reason);
    if (result.contactId !== session.contactId) throw new AuthError('totp_expired', 'انتهت مهلة التفعيل، ابدأ من جديد', 410);
    const me = await this.me(session);
    this.notifyTotp(me.email, 'enabled');
    return { backupCodes: result.backupCodes };
  }

  async totpBackup(session: SessionRecord, code: string): Promise<{ backupCodes: string[] }> {
    const totp = this.requireTotp();
    const verified = await totp.verify(session.contactId, code);
    if (!verified.ok) throw new AuthError(verified.reason === 'none' ? 'totp_off' : 'totp_bad_code', verified.reason === 'none' ? 'الحماية الإضافية غير مفعلة' : 'الرمز غير صحيح', 400);
    const backupCodes = await totp.regenerateBackup(session.contactId);
    if (!backupCodes) throw new AuthError('totp_off', 'الحماية الإضافية غير مفعلة', 400);
    return { backupCodes };
  }

  /** Account: off again with a current code — never for a dashboard account while ADMIN_TOTP is on. */
  async totpDisable(session: SessionRecord, code: string): Promise<void> {
    const totp = this.requireTotp();
    const me = await this.me(session);
    if (this.adminTotpEnabled && (me.isAdmin || me.isModerator)) {
      throw new AuthError('totp_mandatory', 'حسابات إدارة النادي لا يمكنها إيقاف تطبيق المصادقة', 403);
    }
    const verified = await totp.verify(me.id, code);
    if (!verified.ok) throw new AuthError(verified.reason === 'none' ? 'totp_off' : 'totp_bad_code', verified.reason === 'none' ? 'الحماية الإضافية غير مفعلة' : 'الرمز غير صحيح', 400);
    await totp.disable(me.id);
    this.notifyTotp(me.email, 'disabled');
  }

  private requireTotp(): TotpStore {
    if (!this.deps.totp) throw new AuthError('totp_off', 'تطبيق المصادقة غير متاح على هذا الخادم', 503);
    return this.deps.totp;
  }

  /** The role is read again: the hub may have changed it while the code was on its way. */
  private async dashboardContact(uuid: string): Promise<HubContact> {
    const account = await this.deps.hub.call('account', { uuid });
    const contact = account.contact;
    if (!contact || !contact.has_account || (contact.is_admin !== 1 && contact.role !== 'publisher')) {
      await this.dropVisitor(uuid);
      throw new AuthError('forbidden', 'هذه اللوحة لإدارة النادي فقط', 403);
    }
    return contact;
  }

  /** A word to the account's e-mail whenever its authenticator changes; never blocks the action. */
  private notifyTotp(email: string, kind: 'enabled' | 'disabled'): void {
    const text = kind === 'enabled'
      ? ['تم ربط تطبيق المصادقة بحسابك في نادي المستثمرين Investors Club.', 'من الآن يطلب الدخول رمز التطبيق بعد كلمة المرور.', '', 'إذا لم تكن أنت من فعل ذلك فغيّر كلمة مرورك فورًا وتواصل مع إدارة النادي.']
      : ['تم إيقاف الحماية الإضافية (تطبيق المصادقة) على حسابك في نادي المستثمرين Investors Club.', '', 'إذا لم تكن أنت من فعل ذلك فغيّر كلمة مرورك فورًا وتواصل مع إدارة النادي.'];
    void this.deps.mailer?.send({ to: [email], subject: kind === 'enabled' ? 'تم تفعيل الحماية الإضافية على حسابك' : 'تم إيقاف الحماية الإضافية على حسابك', text: text.join('\n') }).catch((error: unknown) => {
      this.deps.log.warn({ err: error instanceof Error ? error.message : 'unknown' }, 'authenticator notice was not mailed');
    });
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

  /**
   * M165 (owner, 2026-10-31, «الأبلكيشن بطيء جدًا»): the hub answers `account` in 1.3 s at best and far
   * slower under load, and every app open used to wait for it. A copy younger than a minute is final; an
   * older one (up to a day) is answered at once while the hub is asked in the background, so the app opens
   * on the last known account and the next request already sees the refreshed one. Only a session with no
   * copy at all, or a caller that insists (`fresh`: after a purchase, a persona change), waits for the hub.
   */
  async me(session: SessionRecord, fresh = false): Promise<Me> {
    const cached = this.meCache.get(session.uuid);
    const age = cached ? Date.now() - cached.at : Number.POSITIVE_INFINITY;
    if (!fresh && cached && age < ME_CACHE_MS) return cached.me;
    if (!fresh && cached && age < ME_STALE_MAX_MS) {
      this.revalidate(session.uuid);
      return cached.me;
    }
    return this.fetchMe(session.uuid);
  }

  private async fetchMe(uuid: string): Promise<Me> {
    // The app gives up after 15 s: a hub that is slower than 10 s is treated as down, not waited for.
    const result = await this.deps.hub.call('account', { uuid }, { timeoutMs: ME_HUB_TIMEOUT_MS });
    if (!result.contact || !result.contact.has_account) {
      this.meCache.delete(uuid);
      throw new AuthError('session_expired', 'انتهت الجلسة، سجّل الدخول من جديد', 401);
    }
    return this.remember(uuid, result.contact);
  }

  /** One background refresh per account at a time; a hub failure keeps the stale copy and is retried on the next call. */
  private revalidate(uuid: string): void {
    if (this.revalidating.has(uuid)) return;
    this.revalidating.add(uuid);
    void this.fetchMe(uuid)
      .catch((error: unknown) => {
        // A gone account drops its copy inside fetchMe; everything else is logged and left for the next call.
        if (!(error instanceof AuthError)) this.deps.log.warn({ err: error }, 'account refresh failed');
      })
      .finally(() => this.revalidating.delete(uuid));
  }

  /** The hub's own view of the account, for server-side calls that need more than `Me` (Projects Bank wants the membership period). */
  async contact(session: SessionRecord): Promise<HubContact> {
    const result = await this.deps.hub.call('account', { uuid: session.uuid });
    if (!result.contact || !result.contact.has_account) {
      throw new AuthError('session_expired', 'انتهت الجلسة، سجّل الدخول من جديد', 401);
    }
    this.remember(session.uuid, result.contact);
    return result.contact;
  }

  async updateProfile(session: SessionRecord, patch: ProfilePatch, source?: AppSource, lang: AppLang = 'ar'): Promise<Me> {
    const body: Record<string, unknown> = { uuid: session.uuid };
    // Hub 2.25.0: the platform rides along so the «اكتمل تسجيل عضو» mail of an older account (no stored source) says Apple / Google.
    if (source) body.source = source;
    if (patch.name !== undefined) {
      // M156: the completion gate (and the editor) fix a kunya or a made-up name — same rule as registration.
      const badName = await nameProblem(patch.name, lang, this.deps.nameJudge);
      if (badName) throw new AuthError('bad_name', badName, 400);
      body.name = patch.name;
    }
    if (patch.contactEmail !== undefined) body.contact_email = patch.contactEmail;
    if (patch.jobTitle !== undefined) body.job_title = patch.jobTitle;
    if (patch.company !== undefined) body.company = patch.company;
    if (patch.city !== undefined) body.city = patch.city;
    if (patch.website !== undefined) body.website = patch.website;
    if (patch.bio !== undefined) body.bio = patch.bio;
    if (patch.social !== undefined) body.social = patch.social;
    if (patch.password) body.password = patch.password;
    if (patch.persona !== undefined) body.persona = patch.persona;
    // M147: phone + interests from the completion gate (the hub validates the phone against the country).
    if (patch.memberType !== undefined) body.member_type = patch.memberType;
    if (patch.phone !== undefined) {
      body.phone = patch.phone;
      body.country = patch.country ?? 'sa';
    }
    if (patch.interests !== undefined) {
      body.interests = patch.interests
        .filter(isInterestKey)
        .map((key) => (key === 'other' && patch.interestsOther?.trim() ? `أخرى: ${patch.interestsOther.trim()}` : interestLabel(key)))
        .join('، ');
    }
    const result = await this.deps.hub.call('profile', body);
    const contact = requireContact(result);
    // A hub plugin older than the persona-aware op_profile silently drops the field: say so instead of pretending.
    if (patch.persona !== undefined && contact.persona !== patch.persona) {
      throw new AuthError('persona_unsupported', 'تغيير الفئة غير متاح حاليًا، حاول لاحقًا', 503);
    }
    return this.remember(session.uuid, contact);
  }

  /**
   * M109d: applies an approved «طلب تغيير الصفة» through the member's own hub visitor uuid
   * (captured at request time). Throws when that hub session is gone — the caller keeps the
   * request pending and asks the admin to retry after the member signs in.
   */
  async applyPersonaFor(uuid: string, persona: Persona): Promise<void> {
    const result = await this.deps.hub.call('profile', { uuid, persona });
    const contact = requireContact(result);
    if (contact.persona !== persona) {
      throw new AuthError('persona_unsupported', 'تغيير الفئة غير متاح حاليًا، حاول لاحقًا', 503);
    }
    this.remember(uuid, contact);
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

  async requestReset(login: string, ip: string, country?: string): Promise<void> {
    await this.deps.hub.call('reset_request', { login: normLogin(login, country), ip });
  }

  async confirmReset(login: string, code: string, password: string, ip: string, country?: string): Promise<void> {
    await this.deps.hub.call('reset_confirm', { login: normLogin(login, country), code, password, ip });
  }

  /** M117: true when the password matches this account — a hub login check, no session is created. */
  async passwordMatches(session: SessionRecord, password: string): Promise<boolean> {
    const me = await this.me(session);
    try {
      const result = await this.deps.hub.call('login', { uuid: newUuid(), ip: 'delete-check', login: me.email, password, page_url: 'app://delete-account' });
      return Boolean(result.contact);
    } catch {
      return false;
    }
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

  /** A member sign-in: straight to a session, unless the account switched the authenticator on (M140). */
  private async signIn(uuid: string, contact: HubContact): Promise<MemberLoginResult> {
    const { totp } = this.deps;
    if (totp && (await totp.enabled(contact.id))) {
      const stepToken = await totp.beginStep(contact.id, uuid, 'app', false);
      return { pending: false, totp: true, stepToken, seconds: TOTP_TOKEN_SECONDS };
    }
    return this.issueSession(uuid, contact, false, false);
  }

  private async issueSession(uuid: string, contact: HubContact, adminVerified: boolean, totpVerified: boolean): Promise<SignedInResult> {
    const token = await this.deps.sessions.createSession(uuid, contact.id, adminVerified, totpVerified);
    return { pending: false, token, me: this.remember(uuid, contact) };
  }

  private remember(uuid: string, contact: HubContact): Me {
    const me = toMe(contact);
    this.meCache.set(uuid, { me, at: Date.now() });
    if (this.meCache.size > 5_000) this.meCache.clear();
    return me;
  }
}

function totpFailure(reason: 'gone' | 'bad_code' | 'locked'): AuthError {
  if (reason === 'bad_code') return new AuthError('totp_bad_code', 'الرمز غير صحيح، تأكد من وقت جهازك وحاول مرة أخرى', 400);
  if (reason === 'locked') return new AuthError('totp_locked', 'محاولات خاطئة كثيرة، ابدأ الدخول من جديد', 429);
  return new AuthError('totp_expired', 'انتهت مهلة الدخول، ابدأ من جديد', 410);
}

function newUuid(): string {
  return `app-${randomUUID()}`;
}

function requireContact(result: HubResponse): HubContact {
  if (!result.contact) throw new AuthError('hub_error', 'استجابة غير مكتملة من النادي', 502);
  return result.contact;
}
