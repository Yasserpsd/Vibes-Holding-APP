import { useQuery } from '@tanstack/react-query';

import { getLang } from '@/i18n';

import { apiGet, apiRequest } from './client';

// Mirrors server/src/auth/service.ts and server/src/auth/routes.ts.
export type Persona = 'neutral' | 'entrepreneur' | 'investor';
export type MembershipStatus = 'unactivated' | 'active' | 'expired';

export type Membership = {
  status: MembershipStatus;
  daysLeft: number | null;
  endDate: string | null;
  aiDailyLimit: number;
  aiDailyLeft: number | null;
};

export type Me = {
  id: number;
  name: string;
  email: string;
  phone: string;
  persona: Persona | '';
  personaLabel: string;
  /** M147: what the sign-in gate still needs (empty = complete); an older server sends none. */
  profileMissing?: ProfileMissing[];
  /** M156: the real address given over an Apple «Hide My Email» relay ('' until given); an older server sends none. */
  contactEmail?: string;
  /** M156: true when the account's e-mail is an Apple private relay. */
  emailRelay?: boolean;
  bio: string;
  jobTitle: string;
  company: string;
  /** M69: «فرد / شركة» chosen at registration; an older server sends none. */
  memberType?: 'individual' | 'company' | '';
  city: string;
  website: string;
  social: string;
  avatarUrl: string;
  verified: boolean;
  isAdmin: boolean;
  membership: Membership;
  /** M30: the number on the membership card; an older server sends none and the card hides it. */
  cardNumber?: string;
  /** M109e: the same data in English (name transliterated) when the app asks in English; an older server sends none. */
  en?: { name: string; jobTitle: string; company: string; city: string; bio: string } | null;
};

/**
 * M109e: the member's data as THIS language displays it — the English app shows the translated
 * block (nothing stays Arabic on the card), the Arabic app the registered data. Display only:
 * the profile editor keeps editing the registered originals.
 */
export function displayProfile(me: Me): { name: string; jobTitle: string; company: string; city: string; bio: string } {
  const { name, jobTitle, company, city, bio } = me;
  return getLang() === 'en' && me.en ? me.en : { name, jobTitle, company, city, bio };
}

/** M109d: the member's own «طلب تغيير الصفة» as the server reports it. */
export type PersonaChangeRequest = {
  id: string;
  to: Persona;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt: string | null;
  adminNote: string | null;
};

/** M64: `nameEn` arrives with the world country list; an older server sends none.
 * M128: `min`/`max`/`starts` describe the country's mobile numbers (length and leading digits)
 * so the app can flag a wrong number as it is typed; an older server sends none. */
export type Country = {
  code: string;
  name: string;
  nameEn?: string;
  dial: string;
  flag: string;
  example: string;
  pattern: string;
  min?: number;
  max?: number;
  starts?: string[];
};

export type AuthConfig = {
  countries: Country[];
  personas: { key: Persona; label: string }[];
  phonePolicy: string;
  emailPolicy: string;
  registrationOpen: boolean;
  adminOnly: boolean;
  /** M46: which social sign-in providers the server accepts; an older server sends none. */
  social?: { google: boolean; apple: boolean };
  hubMode: 'live' | 'mock';
  testCode: string | null;
};

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
  /** M32: another member's membership number; the hub checks and stores it. */
  inviteCode?: string;
  /** M120: interest keys (and the «أخرى» text) — the hub's «عضو جديد» admin mail names them. */
  interests?: string[];
  interestsOther?: string;
};

export type PendingResult = { pending: true; pendingToken: string; email: string; mailSent: boolean; text: string };
export type SignedInResult = { pending: false; token: string; me: Me; /** M157: the social sign-in just created the account. */ created?: boolean };
/** M140: the account switched «حماية إضافية» on — the sign-in ends with its authenticator code. */
export type TotpStepResult = { pending: false; totp: true; stepToken: string; seconds: number };
export type LoginResult = PendingResult | SignedInResult | TotpStepResult;
export type TotpStatus = { enabled: boolean; enabledAt: string | null; backupLeft: number };
export type TotpSetup = { setupToken: string; secret: string; uri: string; seconds: number };

/** M156 adds `name` (a kunya or a made-up name), `jobTitle` and `contactEmail` (an Apple-relay account's real address). */
export type ProfileMissing = 'name' | 'memberType' | 'phone' | 'persona' | 'bio' | 'jobTitle' | 'interests' | 'company' | 'contactEmail';

export type ProfilePatch = Partial<Pick<Me, 'name' | 'jobTitle' | 'company' | 'city' | 'website' | 'bio' | 'social'>> & {
  password?: string;
  /** M74: the neutral's in-app category switch; the hub stores it (one identity source). */
  persona?: Persona;
  /** M147: the completion gate. */
  memberType?: 'individual' | 'company';
  phone?: string;
  country?: string;
  interests?: string[];
  interestsOther?: string;
  /** M156: the real address of an Apple-relay account. */
  contactEmail?: string;
};

export type MembershipBenefit = { icon: string; title: string; detail: string | null };

export type MembershipItemLink = { type: 'whatsapp'; phone: string; message: string } | { type: 'route'; path: string };
export type MembershipItem = { text: string; link: MembershipItemLink | null };
export type MembershipGroup = { key: string; title: string; icon: string; comingSoon: boolean; items: MembershipItem[] };

/** M99d: one of the neutral's ten reasons; `badges` render as gold pills beside the title. */
export type NeutralReason = { title: string; text: string; badges?: string[] };

export type MembershipContent = {
  title: string;
  subtitle: string;
  intro: string;
  groups: MembershipGroup[];
  benefits: MembershipBenefit[];
  /** M99d: the neutral persona's own benefits copy (the owner's 10-reason page). */
  neutralReasons?: { title: string; intro: string; items: NeutralReason[] };
  comingSoonTitle: string;
  comingSoon: string[];
  statusTexts: { guest: string; unactivated: string; active: string; expired: string };
  activationNote: string;
  updatedAt: string;
};

export const authApi = {
  register: (input: RegisterInput) => apiRequest<PendingResult>('POST', '/api/auth/register', { body: input, token: null }),
  resend: (pendingToken: string) => apiRequest<{ mailSent: boolean; text: string }>('POST', '/api/auth/resend', { body: { pendingToken }, token: null }),
  verify: (pendingToken: string, code: string) => apiRequest<SignedInResult | TotpStepResult>('POST', '/api/auth/verify', { body: { pendingToken, code }, token: null }),
  // M140: the authenticator code (or a backup code) that ends a sign-in answered with `totp: true`.
  totp: (stepToken: string, code: string) => apiRequest<SignedInResult>('POST', '/api/auth/totp', { body: { stepToken, code }, token: null }),
  totpStatus: () => apiRequest<TotpStatus>('GET', '/api/me/totp'),
  totpSetup: (code?: string) => apiRequest<TotpSetup>('POST', '/api/me/totp/setup', { body: code ? { code } : {} }),
  totpConfirm: (setupToken: string, code: string) => apiRequest<{ backupCodes: string[] }>('POST', '/api/me/totp/confirm', { body: { setupToken, code } }),
  totpBackup: (code: string) => apiRequest<{ backupCodes: string[] }>('POST', '/api/me/totp/backup', { body: { code } }),
  totpDisable: (code: string) => apiRequest<{ ok: true }>('POST', '/api/me/totp/disable', { body: { code } }),
  // M126: `country` rides along when the member typed a phone number, so the server can build
  // the international digits for any country (the hub itself only understands Saudi local forms).
  login: (login: string, password: string, country?: string) =>
    apiRequest<LoginResult>('POST', '/api/auth/login', { body: { login, password, ...(country ? { country } : {}) }, token: null }),
  // M46: the provider's ID token; the server verifies it itself and signs the member in (or creates the account).
  social: (provider: 'google' | 'apple', token: string, name?: string) =>
    apiRequest<SignedInResult | TotpStepResult>('POST', '/api/auth/social', { body: { provider, token, ...(name ? { name } : {}) }, token: null }),
  resetRequest: (login: string, country?: string) =>
    apiRequest<{ ok: true }>('POST', '/api/auth/reset/request', { body: { login, ...(country ? { country } : {}) }, token: null }),
  resetConfirm: (login: string, code: string, password: string, country?: string) =>
    apiRequest<{ ok: true }>('POST', '/api/auth/reset/confirm', { body: { login, code, password, ...(country ? { country } : {}) }, token: null }),
  me: (token: string, fresh = false) => apiRequest<{ me: Me }>('GET', '/api/me', { token, params: fresh ? { fresh: 1 } : undefined }),
  updateMe: (patch: ProfilePatch) => apiRequest<{ me: Me }>('PATCH', '/api/me', { body: patch }),
  logout: () => apiRequest<{ ok: true }>('POST', '/api/auth/logout', { body: {} }),
  // M101 «تغيير التوجه»: the e-mailed code applies the change at the hub, once every 30 days (admins patch directly).
  personaRequest: (persona: Persona) => apiRequest<{ ok: true; email: string; seconds: number; days: number }>('POST', '/api/me/persona/request', { body: { persona } }),
  personaConfirm: (code: string) => apiRequest<{ me: Me }>('POST', '/api/me/persona/confirm', { body: { code } }),
  // M109d: the yearly window's state plus the member's latest «طلب تغيير الصفة».
  personaState: () => apiRequest<{ daysLeft: number; request: PersonaChangeRequest | null }>('GET', '/api/me/persona/state'),
  personaChangeRequest: (persona: Persona, note?: string) =>
    apiRequest<{ request: PersonaChangeRequest }>('POST', '/api/me/persona/change-request', { body: { persona, ...(note ? { note } : {}) } }),
  // M79: the reason (picked or written) travels with the deletion so the club learns why members leave.
  deleteMe: (password: string, reason?: string) => apiRequest<{ ok: true }>('DELETE', '/api/me', { body: { password, ...(reason ? { reason } : {}) } }),
  // M117: the three-step deletion — password starts it, the mailed code + the shown word confirm it,
  // and the request only SCHEDULES the deletion 30 days ahead (cancellable the whole time).
  deleteStart: (password: string, reason?: string) =>
    apiRequest<{ ok: true; email: string; seconds: number; word: string; days: number }>('POST', '/api/me/delete/start', { body: { password, ...(reason ? { reason } : {}) } }),
  deleteConfirm: (code: string, word: string) => apiRequest<{ ok: true; dueAt: string; daysLeft: number }>('POST', '/api/me/delete/confirm', { body: { code, word } }),
  deleteState: () => apiGet<{ scheduled: { dueAt: string; daysLeft: number } | null }>('/api/me/delete/state'),
  deleteCancel: () => apiRequest<{ ok: true; cancelled: boolean }>('POST', '/api/me/delete/cancel', { body: {} }),
};

export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth', 'config'],
    queryFn: () => apiGet<AuthConfig>('/api/auth/config'),
    staleTime: 10 * 60_000,
  });
}

export function useMembershipContent() {
  return useQuery({
    queryKey: ['membership', 'content'],
    queryFn: () => apiGet<MembershipContent>('/api/membership'),
    staleTime: 10 * 60_000,
  });
}
