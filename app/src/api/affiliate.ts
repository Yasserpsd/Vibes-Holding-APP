import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';

import { apiGet, apiRequest } from './client';

// Mirrors server/src/affiliate/routes.ts (M184): «برنامج ممثلي النادي».
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
  appliedAt: string;
  agreementAcceptedAt: string | null;
  adminNote: string | null;
};

/** One registration through the affiliate's code; paid = the server confirmed the membership payment. */
export type AffiliateReferral = { name: string; at: string; paid: boolean };

export type AffiliateBalance = {
  commission: number;
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
  application: AffiliateApplication | null;
  /** Present only once the administration approved the affiliate. */
  code?: string;
  link?: string;
  shareText?: string;
  referrals?: AffiliateReferral[];
  balance?: AffiliateBalance;
  payouts?: AffiliatePayout[];
};

export type AffiliateForm = {
  entityType: AffiliateEntityType;
  bankName: string;
  accountName: string;
  iban: string;
  city: string;
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
