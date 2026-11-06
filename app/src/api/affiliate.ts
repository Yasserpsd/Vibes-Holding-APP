import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';

import { apiGet, apiRequest } from './client';

// Mirrors server/src/affiliate/routes.ts (M184): «برنامج ممثلي نادي المستثمرين».
export type AffiliateStatus = 'none' | 'agreement' | 'pending' | 'approved' | 'rejected';

export type AffiliateEntityType = 'individual' | 'company';

export type AffiliateApplication = {
  status: Exclude<AffiliateStatus, 'none'>;
  entityType: AffiliateEntityType;
  bankName: string;
  accountName: string;
  iban: string;
  city: string;
  address: string;
  heardFrom: string;
  heardFromNote: string;
  /** M195: the city as a list key ('other' = typed freely); an older server sends none. */
  cityKey?: string;
  appliedAt: string;
  agreementAcceptedAt: string | null;
  adminNote: string | null;
};

/** One registration through the affiliate's code; paid = the server confirmed the membership payment. */
export type AffiliateReferral = { name: string; at: string; paid: boolean };

/** M186: the performance-cycle counter; an older server sends none. */
export type AffiliateCycle = {
  n: number;
  startAt: string;
  endAt: string;
  daysLeft: number;
  target: number;
  paid: number;
  bonus: number;
  achieved: boolean;
  bonusAt: string | null;
  state: 'running' | 'renewal';
};

export type AffiliateBalance = {
  /** The rate for the next paying referral (follows the affiliate's own membership). */
  commission: number;
  /** M186 tiers; an older server sends none. */
  commissionBase?: number;
  commissionMember?: number;
  member?: boolean;
  bonuses?: number;
  /** Paid referrals required before a payout may be requested; an older server sends none. */
  minPaid?: number;
  referrals: number;
  paid: number;
  unpaid: number;
  earned: number;
  withdrawn: number;
  available: number;
};

export type AffiliatePayoutStatus = 'requested' | 'paid' | 'rejected';

export type AffiliatePayout = {
  id: string;
  amount: number;
  status: AffiliatePayoutStatus;
  requestedAt: string;
  decidedAt: string | null;
  adminNote: string | null;
};

export type AffiliateOverview = {
  status: AffiliateStatus;
  commission: number;
  introText: string;
  agreementText: string;
  heardOptions: string[];
  /** M195: the same options as {value (the stored Arabic), label (the app's language)}; an older server sends none. */
  heardChoices?: { value: string; label: string }[];
  /** M195: the Saudi cities to pick from (value = key, label in the app's language), 'other' last; an older server sends none. */
  cities?: { value: string; label: string }[];
  application: AffiliateApplication | null;
  /** Present only once the administration approved the affiliate. `code` is the short alias («FAR2»). */
  code?: string;
  link?: string;
  shareText?: string;
  referrals?: AffiliateReferral[];
  balance?: AffiliateBalance;
  cycle?: AffiliateCycle | null;
  payouts?: AffiliatePayout[];
};

export type AffiliateForm = {
  entityType: AffiliateEntityType;
  bankName: string;
  accountName: string;
  iban: string;
  city: string;
  /** M195: the typed city when `city` is 'other'. */
  cityOther?: string;
  address: string;
  heardFrom: string;
  heardFromNote: string;
};

export type PayoutForm = { bankName: string; accountName: string; iban: string };

export const affiliateApi = {
  overview: () => apiGet<AffiliateOverview>('/api/affiliate'),
  apply: (input: AffiliateForm) => apiRequest<{ application: AffiliateApplication }>('POST', '/api/affiliate/apply', { body: input }),
  acceptAgreement: () => apiRequest<{ application: AffiliateApplication }>('POST', '/api/affiliate/agreement', { body: {} }),
  requestPayout: (input: PayoutForm) => apiRequest<{ payout: AffiliatePayout }>('POST', '/api/affiliate/payout', { body: input }),
};

export function useAffiliate(enabled: boolean) {
  const { me } = useAuth();
  return useQuery({
    queryKey: ['affiliate', 'mine', me?.id ?? 0],
    queryFn: affiliateApi.overview,
    enabled,
    staleTime: 30_000,
  });
}
