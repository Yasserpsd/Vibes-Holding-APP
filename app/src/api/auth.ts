import { useQuery } from '@tanstack/react-query';

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
  /** M30: the number on the membership card; an older server sends none and the card hides it. */
  cardNumber?: string;
};

export type Country = { code: string; name: string; dial: string; flag: string; example: string; pattern: string };

export type AuthConfig = {
  countries: Country[];
  personas: { key: Persona; label: string }[];
  phonePolicy: string;
  emailPolicy: string;
  registrationOpen: boolean;
  adminOnly: boolean;
  hubMode: 'live' | 'mock';
  testCode: string | null;
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
  /** M32: another member's membership number; the hub checks and stores it. */
  inviteCode?: string;
};

export type PendingResult = { pending: true; pendingToken: string; email: string; mailSent: boolean; text: string };
export type SignedInResult = { pending: false; token: string; me: Me };
export type LoginResult = PendingResult | SignedInResult;

export type ProfilePatch = Partial<Pick<Me, 'name' | 'jobTitle' | 'company' | 'city' | 'website' | 'bio' | 'social'>> & {
  password?: string;
};

export type MembershipBenefit = { icon: string; title: string; detail: string | null };

export type MembershipItemLink = { type: 'whatsapp'; phone: string; message: string } | { type: 'route'; path: string };
export type MembershipItem = { text: string; link: MembershipItemLink | null };
export type MembershipGroup = { key: string; title: string; icon: string; comingSoon: boolean; items: MembershipItem[] };

export type MembershipContent = {
  title: string;
  subtitle: string;
  intro: string;
  groups: MembershipGroup[];
  benefits: MembershipBenefit[];
  comingSoonTitle: string;
  comingSoon: string[];
  statusTexts: { guest: string; unactivated: string; active: string; expired: string };
  activationNote: string;
  updatedAt: string;
};

export const authApi = {
  register: (input: RegisterInput) => apiRequest<PendingResult>('POST', '/api/auth/register', { body: input, token: null }),
  resend: (pendingToken: string) => apiRequest<{ mailSent: boolean; text: string }>('POST', '/api/auth/resend', { body: { pendingToken }, token: null }),
  verify: (pendingToken: string, code: string) => apiRequest<SignedInResult>('POST', '/api/auth/verify', { body: { pendingToken, code }, token: null }),
  login: (login: string, password: string) => apiRequest<LoginResult>('POST', '/api/auth/login', { body: { login, password }, token: null }),
  resetRequest: (login: string) => apiRequest<{ ok: true }>('POST', '/api/auth/reset/request', { body: { login }, token: null }),
  resetConfirm: (login: string, code: string, password: string) =>
    apiRequest<{ ok: true }>('POST', '/api/auth/reset/confirm', { body: { login, code, password }, token: null }),
  me: (token: string, fresh = false) => apiRequest<{ me: Me }>('GET', '/api/me', { token, params: fresh ? { fresh: 1 } : undefined }),
  updateMe: (patch: ProfilePatch) => apiRequest<{ me: Me }>('PATCH', '/api/me', { body: patch }),
  logout: () => apiRequest<{ ok: true }>('POST', '/api/auth/logout', { body: {} }),
  deleteMe: (password: string) => apiRequest<{ ok: true }>('DELETE', '/api/me', { body: { password } }),
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
