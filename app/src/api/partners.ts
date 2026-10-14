import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';

import { apiGet } from './client';

// Mirrors server/src/partners (M68 «شركاؤنا»).
export type Partner = {
  id: string;
  name: string;
  description: string;
  /** The discount line as the owner words it, e.g. «خصم 20% لأعضاء النادي بالبرومو كود». */
  discount: string;
  url: string;
  logoUrl: string | null;
};

export type PartnersContent = {
  title: string;
  intro: string;
  codeTitle: string;
  codeHint: string;
  membersOnlyText: string;
  partners: Partner[];
  isMember: boolean;
  /** The member's own permanent promo code; null for guests and accounts without an active membership. */
  promo: { code: string } | null;
};

/** The promo code depends on the account, so the cache key follows the session (same pattern as useServices). */
export function usePartners() {
  const { status, me } = useAuth();
  const account = status === 'signedIn' && me ? `${me.id}:${me.membership.status}` : 'guest';
  return useQuery({
    queryKey: ['partners', account],
    queryFn: () => apiGet<PartnersContent>('/api/partners'),
    staleTime: 5 * 60_000,
  });
}
